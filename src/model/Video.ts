import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface VideoAttributes{
    id: string;
    userId: string;
    projectId: string;
    status: "queued" | "processing" |"completed"| "failed";
    progress: number;
    currentStep: string;
    videoUrl?: string | null;
    thumbnailUrl: string | null;
    duration?: number | null;
    fileSize?: number | null;
    errorMessage? : string | null;
}

interface VideoCreationAttributes extends Optional<VideoAttributes, "id">{}

export class Video extends Model<VideoAttributes, VideoCreationAttributes> implements VideoAttributes{
  declare id: string;
  declare userId: string;
  declare projectId: string;
  declare status: 'queued' | 'processing' | 'completed' | 'failed';
  declare progress: number;
  declare currentStep: string;
  declare videoUrl: string | null;
  declare thumbnailUrl: string | null;
  declare duration: number | null;
  declare fileSize: number | null;
  declare errorMessage: string | null;
}

Video.init({
    id:{
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId:{
        type: DataTypes.UUID,
        allowNull: false
    },
    projectId:{
        type: DataTypes.UUID,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'),
        defaultValue: 'queued'
    },
    progress:{
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    currentStep: {
        type: DataTypes.STRING(100),
        defaultValue: 'Initializing...'
    },
    videoUrl: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    thumbnailUrl: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    duration:{
        type: DataTypes.FLOAT,
        allowNull: true
    },
    fileSize: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    errorMessage:{
        type: DataTypes.TEXT,
        allowNull: true
    }
      
},{
    sequelize,
    tableName: "video",
    timestamps: true
})