// Shared helpers for scripts/dev.mjs, scripts/local.mjs and
// scripts/test-store-local.mjs: making sure Docker Desktop is up, starting
// the local Redis + serverless-redis-http stack (docker-compose.yml), and
// printing the URLs to open (localhost + this machine's LAN IPv4s).
//
// Plain Node (no shell-only syntax), so this runs the same on Windows,
// macOS and Linux.

import { spawnSync } from "node:child_process";
import os from "node:os";

/**
 * Checked with `docker info`, which only succeeds if the Docker daemon
 * (Docker Desktop, on Windows) is actually up — not just installed.
 * Exits the process with a Korean error message if it isn't, since every
 * caller of this needs Docker before it can do anything useful.
 */
export function ensureDockerRunning() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    console.error("Docker Desktop을 먼저 켜 주세요.");
    process.exit(1);
  }
}

/**
 * Starts (or reuses) the stack in docker-compose.yml and waits until every
 * service reports healthy before returning.
 */
export function startLocalRedis() {
  console.log("[local-redis] docker compose up --wait ...");
  const result = spawnSync("docker", ["compose", "up", "-d", "--wait"], {
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    console.error(
      "[local-redis] 로컬 Redis를 켜지 못했습니다. 위 로그를 확인해 주세요.",
    );
    process.exit(result.status ?? 1);
  }
  console.log("[local-redis] 로컬 Redis 준비 완료 (127.0.0.1:6379, 127.0.0.1:8079).");
}

// Adapter names that are almost always virtual (WSL, Hyper-V default
// switch, VPN/virtualization tooling, ...), not the Wi-Fi/Ethernet adapter
// a phone would actually reach. We can't always tell for certain, so these
// are only de-prioritized in the printed list, never hidden.
const LIKELY_VIRTUAL_ADAPTER = /wsl|hyper-v|vethernet|virtualbox|vmware|docker/i;

/**
 * This machine's non-internal IPv4 addresses, real-looking adapters first,
 * each tagged with whether its adapter name matched LIKELY_VIRTUAL_ADAPTER.
 */
function getLanIPv4AddressDetails() {
  const interfaces = os.networkInterfaces();
  const real = new Map();
  const likelyVirtual = new Map();

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const addr of addresses ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const isVirtual = LIKELY_VIRTUAL_ADAPTER.test(name);
      const target = isVirtual ? likelyVirtual : real;
      target.set(addr.address, { address: addr.address, isVirtual });
    }
  }

  return [...real.values(), ...likelyVirtual.values()];
}

/**
 * This machine's non-internal IPv4 addresses, real-looking adapters first.
 */
export function getLanIPv4Addresses() {
  return getLanIPv4AddressDetails().map((detail) => detail.address);
}

/** Prints the URLs to open, plus the Windows Firewall reminder. */
export function printLocalUrls(port) {
  console.log("");
  console.log("아래 주소로 접속하세요:");
  console.log(`  http://localhost:${port}`);
  for (const { address, isVirtual } of getLanIPv4AddressDetails()) {
    const label = isVirtual
      ? "(가상 네트워크 주소 · 휴대폰 접속용 아님)"
      : "(같은 Wi-Fi의 휴대폰/태블릿용)";
    console.log(`  http://${address}:${port}  ${label}`);
  }
  console.log("");
  console.log(
    "참고: 휴대폰 등 다른 기기로 처음 접속할 때 Windows 방화벽이 Node.js의 " +
      "연결을 허용할지 물으면 '허용'을 눌러야 접속됩니다.",
  );
  console.log("");
}
