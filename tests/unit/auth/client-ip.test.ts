import { describe, expect, it } from "vitest";

import { UNKNOWN_CLIENT, resolveClientIp } from "@/lib/auth/client-ip";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("resolveClientIp", () => {
  it("untrusted: uses x-forwarded-for (set by Next from the socket), ignores x-real-ip", () => {
    expect(
      resolveClientIp(
        headers({ "x-forwarded-for": "192.168.0.18", "x-real-ip": "1.2.3.4" }),
        false,
      ),
    ).toBe("192.168.0.18");
  });

  it("trusted: prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(
      resolveClientIp(
        headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1", "x-real-ip": "1.2.3.4" }),
        true,
      ),
    ).toBe("1.2.3.4");
    expect(
      resolveClientIp(headers({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" }), true),
    ).toBe("5.6.7.8");
  });

  it("normalizes IPv4-mapped IPv6 and case", () => {
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "::ffff:127.0.0.1" }), false),
    ).toBe("127.0.0.1");
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "2001:DB8::1" }), false),
    ).toBe("2001:db8::1");
  });

  it("drops an IPv6 zone ID instead of falling back to the shared bucket", () => {
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "fe80::1%eth0" }), false),
    ).toBe("fe80::1");
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "FE80::ABCD%25" }), false),
    ).toBe("fe80::abcd");
    expect(
      resolveClientIp(headers({ "x-real-ip": " fe80::2%en0 " }), true),
    ).toBe("fe80::2");
    expect(
      resolveClientIp(
        headers({ "x-forwarded-for": "fe80::3%wlan0, 10.0.0.1" }),
        true,
      ),
    ).toBe("fe80::3");
  });

  it("does not treat % in a non-IPv6 value as a zone", () => {
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "1.2.3.4%eth0" }), false),
    ).toBe(UNKNOWN_CLIENT);
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "%eth0" }), false),
    ).toBe(UNKNOWN_CLIENT);
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "evil%fe80::1" }), false),
    ).toBe(UNKNOWN_CLIENT);
  });

  it("falls back to a shared bucket for missing or junk values", () => {
    expect(resolveClientIp(headers({}), false)).toBe(UNKNOWN_CLIENT);
    expect(resolveClientIp(headers({}), true)).toBe(UNKNOWN_CLIENT);
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "auth:lock:evil" }), false),
    ).toBe(UNKNOWN_CLIENT);
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "1".repeat(100) }), false),
    ).toBe(UNKNOWN_CLIENT);
  });
});
