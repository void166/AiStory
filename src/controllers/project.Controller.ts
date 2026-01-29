import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { Project } from "../model/Project";

export class ProjecController {

    async createProject(req: AuthRequest, res: Response) {

        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized user"
                });
            }

            const { title, topic } = req.body;

            if (!title || !topic) {
                return res.status(400).json({
                    success: false,
                    message: "Title required"
                });
            }

            const project = await Project.create({
                title,
                topic,
                userId
            });

            return res.status(201).json({
                success: true,
                project
            });

        } catch (err: any) {

            console.error(err);

            return res.status(500).json({
                success: false,
                message: err.message || "Server error"
            });
        }
    }

    async getProjects(req:AuthRequest,res: Response){
        const userId = req.user?.id;
        try{
            const projects = await Project.findAll({
                where: {
                    userId
                },
                order: [["createdAt", "DESC"]]
            });

            return res.status(200).json({
                success: true,
                projects
            });

        }catch(err:any){
            return res.status(500).json({
                success: false,
                message: err.message
            })
        }
    }
    async getProjectDetails(req:Request, res:Response){
        
    }

}
