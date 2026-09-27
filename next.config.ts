import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// EPIC 1-6: Next 16 blocks cross-origin requests to the dev server by
// default, so a phone/tablet on the same LAN can't use `npm run dev`
// unless its origin is allow-listed here. These cover the private IPv4
// ranges a home/office router hands out (RFC 1918): 192.168.0.0/16,
// 10.0.0.0/8, and 172.16.0.0/12.
const privateLanOrigins = [
  "192.168.*.*",
  "10.*.*.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: privateLanOrigins,
};

export default withWorkflow(nextConfig);
