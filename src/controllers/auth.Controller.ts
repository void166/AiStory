import { User } from "../model/User";
import { LoginUpDTO, SignUpDTO } from "../types";
import { Request, Response } from "express";
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { config } from "../config";


const {JWT_SECRET}= config;


export class AuthController{
    async signUp(req:Request, res: Response){
        try{
            const {email, password, fullname}: SignUpDTO = req.body; 

            if(!email || !password || !fullname){
                return res.status(400).json({
                    success: false,
                    message: "email pass bhguen"
                })
            }


            const existingUser = await User.findOne({
                where: {
                    email: email
                }
            });
            if(existingUser)
                return res
                    .status(400)
                    .json("hereglegch burtgeltei bnaa");
                
            const hashedPass = await bcrypt.hash(password, 10);

            const newUser =await User.create({
                email: email,
                fullname,
                password: hashedPass
            });

            res.status(200).json({
                success: true,
                user: {newUser}
            })

        }catch(err: any){
            return res.status(500).json({
                success: false,
                mesage: err.message
            })
        }
    }

    async loginUp(req: Request, res: Response){
        const {email, password}: LoginUpDTO = req.body;
            if(!email || !password){
                return res.status(400).json({
                    success: false,
                    message: "email pass bhguen"
                })
            }

            const user = await User.findOne({
                where: {
                    email: email
                }
            });
            if(!user)
                return res.status(400).json({
                    success: false,
                    messagee: "burtgeltei hereglegch bnaa"
            })

            const isMatch = await bcrypt.compare(password, user.password);

            if(!isMatch)
                return res.status(400).json({
                    success: false,
                    message: "Password buruu bn"
            });

            const token =jwt.sign({
                id: user.id,
                email,
            },JWT_SECRET,
        {
            expiresIn: "1d"
        });
        
        return res.status(200).json({
            success: true,
            user: {
                email,
                password,
                token
            } 
        });
    }
}