import dotenv from 'dotenv';

dotenv.config();

export const config = {
    DB_USER : process.env.DB_USER!,
    DB_PASSWORD: process.env.DB_PASSWORD!,
    DB_HOST: process.env.DB_HOST!,
    JWT_SECRET: process.env.JWT_SECRET!,
    DB_NAME: process.env.DB_NAME!,
    DB_PORT: process.env.DB_PORT! ? parseInt(process.env.DB_PORT, 10) : 5432,
    PORT: process.env.PORT! ? parseInt(process.env.PORT, 10) : 5000,
    FRONTEND_URL: process.env.FRONTEND_URL!,
    GROQ_API: process.env.GROQ_API || "",
    MAGICHOUR_API: process.env.MAGICHOUR_API || "",
    NANO_BANANA_API: process.env.NANO_BANANA_API || "",
    CHIMEGE_VOICE_API: process.env.CHIMEGE_VOICE_API || "",
    CLOUDNAME: process.env.CLOUDNAME || "",
    CLOUD_API_KEY: process.env.CLOUD_API_KEY || "",
    CLOUD_API_SECRET: process.env.CLOUD_API_SECRET || "",
}