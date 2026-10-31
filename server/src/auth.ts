import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
const secret: string = process.env.JWT_SECRET ?? "";
if (!secret) throw new Error("JWT_SECRET is required");
export function signAdmin(id: string) { return jwt.sign({ sub: id, role: "admin" }, secret, { expiresIn: "12h" }); }
export interface AuthRequest extends Request { adminId?: string }
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.role !== "admin" || typeof payload.sub !== "string") throw new Error("Invalid token");
    req.adminId = payload.sub; next();
  } catch { return res.status(401).json({ error: "Invalid or expired token" }); }
}
