import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

interface AdminJwtPayload {
  id: string;
  email: string;
  role: "superadmin" | "admin";
  isAdmin: true;
}

export interface AdminRequest extends Request {
  admin?: AdminJwtPayload;
}

export const adminMiddleware = (
  req: AdminRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: "Token байхгүй" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as AdminJwtPayload;
    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: "Admin эрх байхгүй" });
    }
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};
