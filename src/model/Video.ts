import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface VideoAttributes{
    id: string;
    userId: string;
    projectId: string;
    title: string;
    topic: string;
    genre: string;
    language: string;
    imageStyle: string;
    bgmPath?: string | null;
    bgmVolume?: number | null;
    srtPath?: string | null;
    duration: number | null;
    status: "draft" | "processing" |"rendering"|"completed"| "failed";
    progress: number;
    current_version: string;
    final_video_url: string | null;
    thumbnail_url: string | null;
    fileSize?: number | null;
    errorMessage? : string | null;
}

interface VideoCreationAttributes extends Optional<VideoAttributes, "id">{}

export class Video extends Model<VideoAttributes, VideoCreationAttributes> implements VideoAttributes{
  declare id: string;
  declare userId: string;
  declare title: string;
  declare topic : string;
  declare genre: string;
  declare language: string;
  declare projectId: string;
  declare status: "draft" | "processing" |"rendering"|"completed"| "failed";
  declare progress: number;
  declare current_version: string;
  declare final_video_url: string | null;
  declare thumbnail_url: string | null;
  declare duration: number | null;
  declare fileSize: number | null;
  declare errorMessage: string | null;
  declare imageStyle: string;
  declare bgmPath: string | null;
  declare bgmVolume: number | null;
  declare srtPath: string | null;
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
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    topic:{
        type: DataTypes.STRING,
        allowNull: false
    },
    genre:{
        type: DataTypes.STRING,
        allowNull: false
    },
    projectId:{
        type: DataTypes.UUID,
        allowNull: false,
    },
    language:{
        type: DataTypes.STRING,
        allowNull: false
    },
    imageStyle:{
        type: DataTypes.STRING,
        allowNull: false
    },
    bgmPath:{
        type: DataTypes.STRING,
        allowNull: true,
    },
    bgmVolume: {
        type: DataTypes.FLOAT,
        allowNull: true,
    },
    srtPath: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    status: {
        type: DataTypes.ENUM('draft', 'processing','rendering', 'completed', 'failed'),
        defaultValue: 'processing'
    },
    progress:{
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    current_version: {
        type: DataTypes.STRING(100),
        defaultValue: 'Initializing...'
    },
    final_video_url: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    thumbnail_url: {
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