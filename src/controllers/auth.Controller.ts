import { User } from "../model/User";
import { LoginUpDTO, SignUpDTO } from "../types";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";

const { JWT_SECRET } = config;

export class AuthController {
  async signUp(req: Request, res: Response) {
    try {
      const { email, password, fullname }: SignUpDTO = req.body;

      if (!email || !password || !fullname) {
        return res.status(400).json({
          success: false,
          message: "Email, password, fullname required",
        });
      }

      const existingUser = await User.findOne({
        where: { email },
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Хэрэглэгч бүртгэлтэй байна",
        });
      }

      const hashedPass = await bcrypt.hash(password, 10);

      const newUser = await User.create({
        email,
        fullname,
        password: hashedPass,
      });

      return res.status(201).json({
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          fullname: newUser.fullname,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }

  async loginUp(req: Request, res: Response) {
    try {
      const { email, password }: LoginUpDTO = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email, password required",
        });
      }

      const user = await User.findOne({
        where: { email },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Хэрэглэгч олдсонгүй",
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Password буруу байна",
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
        },
        JWT_SECRET,
        {
          expiresIn: "1d",
        }
      );

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          fullname: user.fullname,
          token,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
}