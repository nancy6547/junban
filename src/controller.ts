// The controller sits between the page and the network using the Chrome
// DevTools Protocol "Fetch" domain. Every fetch/XHR response is paused when
// it arrives at the browser. Then:
//
//   record mode   -> release it right away and note the order things arrived
//   schedule mode -> hold it, and release responses in the order we choose
//
// Releasing in a chosen order is what lets Junban try "what if /api/cart
// came back before /api/user?" on purpose, instead of waiting for luck.

import type { CDPSession, Page } from "@playwright/test";
import { KeyCounter } from "./key.js";

export type Schedule = string[] | null; // null = record mode

export interface RequestEvent {
  key: string;
  url: string;
  sentAt: number; // ms since attach
  arrivedAt?: number; // response reached the browser (paused)
  releasedAt?: number; // we let the page see it
  skipped?: boolean; // in the schedule but never arrived in time
}

export interface ControllerOptions {
  /** wait this long for a scheduled request that hasn't even been sent yet */
  notSentMs?: number;
  /** never hold a response longer than this (safety net against deadlocks) */
  maxHoldMs?: number;
  /** gap after each release so the page's JS handles responses in order */
  settleMs?: number;
}

interface Held {
  requestId: string;
  key: string;
}

export class Controller {
  readonly events: RequestEvent[] = [];
  private cdp!: CDPSession;
  private t0 = Date.now();
  private counter = new KeyCounter();
  private byNetworkId = new Map<string, RequestEvent>();
  private held = new Map<string, Held>(); // key -> paused response
  private done = new Set<string>(); // keys released or skipped
  private timer: NodeJS.Timeout | null = null;
  private releasing = Promise.resolve();
  private opts: Required<ControllerOptions>;

  constructor(
    private page: Page,
    private schedule: Schedule,
    opts: ControllerOptions = {},
  ) {
    this.opts = { notSentMs: 300, maxHoldMs: 4000, settleMs: 40, ...opts };
  }

  private now() {
    return Date.now() - this.t0;
  }

  async attach(): Promise<void> {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.t0 = Date.now();

    // Network domain: we learn about a request when it is SENT, so we know
    // whether a scheduled request is on its way or hasn't happened yet.
    this.cdp.on("Network.requestWillBeSent", (e) => {
      if (e.type !== "Fetch" && e.type !== "XHR") return;
      if (e.redirectResponse) return; // same request, keep the first key
      const ev: RequestEvent = {
        key: this.counter.next(e.request.method, e.request.url),
        url: e.request.url,
        sentAt: this.now(),
      };
      this.events.push(ev);
      this.byNetworkId.set(e.requestId, ev);
      this.kick();
    });

    // Fetch domain: pause every fetch/XHR response when it arrives.
    this.cdp.on("Fetch.requestPaused", (e) => {
      const ev = e.networkId ? this.byNetworkId.get(e.networkId) : undefined;
      if (!ev) {
        // not something we track: let it through
        this.cdp.send("Fetch.continueRequest", { requestId: e.requestId }).catch(() => {});
        return;
      }
      ev.arrivedAt = this.now();
      if (!this.schedule || !this.schedule.includes(ev.key) || this.done.has(ev.key)) {
        // record mode, unknown request, or one we already gave up on
        this.release({ requestId: e.requestId, key: ev.key });
        return;
      }
      this.held.set(ev.key, { requestId: e.requestId, key: ev.key });
      this.kick();
    });

    await this.cdp.send("Network.enable");
    await this.cdp.send("Fetch.enable", {
      patterns: [
        { resourceType: "Fetch", requestStage: "Response" },
        { resourceType: "XHR", requestStage: "Response" },
      ],
    });
  }

  /** Release whatever the schedule allows right now. */
  private kick() {
    if (!this.schedule) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const next = this.schedule.find((k) => !this.done.has(k));
    if (next === undefined) {
      // schedule finished: anything still held goes through
      for (const h of this.held.values()) this.release(h);
      return;
    }
    const h = this.held.get(next);
    if (h) {
      this.release(h).then(() => this.kick());
      return;
    }

    // `next` hasn't arrived yet.
    const inFlight = this.events.some((e) => e.key === next && e.arrivedAt === undefined);
    if (inFlight || this.held.size === 0) {
      // It's on its way (or nothing is being held back): wait for it, but not forever.
      this.timer = setTimeout(() => this.skip(next), this.opts.maxHoldMs);
      return;
    }
    // Not even sent, and we're holding responses. The page may only send
    // `next` after it sees one of them (e.g. /api/recs needs /api/session).
    // Let the held response we care LEAST about through, then look again.
    this.timer = setTimeout(() => {
      const latest = [...this.held.values()].sort(
        (a, b) => this.schedule!.indexOf(b.key) - this.schedule!.indexOf(a.key),
      )[0];
      if (latest) this.release(latest).then(() => this.kick());
      else this.kick();
    }, this.opts.notSentMs);
  }

  /** Give up on a scheduled request (never sent, or depends on a held one). */
  private skip(key: string) {
    if (this.done.has(key)) return;
    this.done.add(key);
    const ev = this.events.find((e) => e.key === key);
    if (ev) ev.skipped = true;
    this.kick();
  }

  private release(h: Held): Promise<void> {
    this.held.delete(h.key);
    this.done.add(h.key);
    const ev = this.events.find((e) => e.key === h.key);
    this.releasing = this.releasing.then(async () => {
      if (ev) ev.releasedAt = this.now();
      await this.cdp.send("Fetch.continueRequest", { requestId: h.requestId }).catch(() => {});
      if (this.schedule) await new Promise((r) => setTimeout(r, this.opts.settleMs));
    });
    return this.releasing;
  }

  /** Order in which responses reached the page (what the app actually saw). */
  releaseOrder(): string[] {
    return this.events
      .filter((e) => e.releasedAt !== undefined)
      .sort((a, b) => a.releasedAt! - b.releasedAt!)
      .map((e) => e.key);
  }

  async detach() {
    if (this.timer) clearTimeout(this.timer);
    for (const h of this.held.values()) await this.release(h);
    await this.releasing;
    await this.cdp.detach().catch(() => {});
  }
}
