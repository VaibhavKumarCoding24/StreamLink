import { Router } from "express";
import { z } from "zod";
import { DeviceTrustService } from "../services/deviceTrust.service";

const pairSchema = z.object({
  deviceName: z.string().min(2),
  deviceType: z.enum(["web", "android"]),
  fingerprint: z.string().min(4),
  pin: z.string().length(6)
});

const hostSchema = z.object({
  deviceName: z.string().min(2),
  fingerprint: z.string().min(4)
});

const verifySchema = z.object({
  deviceId: z.string().min(2),
  accessToken: z.string().min(8)
});

export const createPairingRouter = (deviceTrustService: DeviceTrustService) => {
  const router = Router();

  router.post("/pin", (req, res) => {
    const deviceName = typeof req.body?.deviceName === "string" ? req.body.deviceName : "Laptop Host";
    const session = deviceTrustService.createPairingSession(deviceName);
    res.json(session);
  });

  router.post("/host", (req, res) => {
    const parsed = hostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const device = deviceTrustService.registerHostDevice(parsed.data);
    return res.json(device);
  });

  router.post("/trust", (req, res) => {
    const parsed = pairSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      const trusted = deviceTrustService.trustDevice(parsed.data);
      return res.json(trusted);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to pair device" });
    }
  });

  router.post("/verify", (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const device = deviceTrustService.verifyDevice(parsed.data.deviceId, parsed.data.accessToken);
    if (!device) {
      return res.status(401).json({ error: "Invalid device credentials" });
    }

    return res.json(device);
  });

  router.get("/devices", (_req, res) => {
    res.json(deviceTrustService.listTrustedDevices());
  });

  return router;
};