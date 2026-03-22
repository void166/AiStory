import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface SceneAttributes{
    id: string;
    video_version_id: string;
    scene_order: string;
    start_time_ms: string;
    end_time_ms: number;
    scene_title: string;
    narration_text: string | null; 
    imagePrompt: string | null;
    subtitle_text: string | null;
    imageUrl: string | null;
    audioUrl: string | null;
    scene_video_url: string | null;
    audio_duration_ms: number | null;
    transition_type : string | null;
    motion_effect: string;
    createdAt: Date;
    updatedAt: Date;
}

interface SceneCreationAttributes extends Optional<SceneAttributes, "id">{}

export class Scene extends Model<SceneAttributes, SceneCreationAttributes> implements SceneAttributes{
  declare id: string;
  declare video_version_id: string;
  declare scene_order: string;
  declare start_time_ms: string;
  declare end_time_ms: number;
  declare scene_title: string;
  declare narration_text: string | null;
  declare imagePrompt: string | null;
  declare subtitle_text: string | null;
  declare imageUrl: string | null;
  declare audioUrl: string | null;
  declare scene_video_url: string | null;
  declare audio_duration_ms : number | null;
  declare transition_type: string | null;
  declare motion_effect: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Scene.init({
    id:{
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    video_version_id:{
        type: DataTypes.UUID,
        allowNull: false
    },
    scene_order:{
        type: DataTypes.UUID,
        allowNull: false,
    },
    start_time_ms: {
        type: DataTypes.ENUM('draft', 'processing','rendering', 'completed', 'failed'),
        defaultValue: 'processing'
    },
    end_time_ms:{
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    scene_title: {
        type: DataTypes.STRING(100),
        defaultValue: 'Initializing...'
    },
    narration_text: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    imagePrompt: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    subtitle_text:{
        type: DataTypes.FLOAT,
        allowNull: true
    },
    imageUrl: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    audioUrl:{
        type: DataTypes.TEXT,
        allowNull: true
    },
    scene_video_url: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    audio_duration_ms: {
        type: DataTypes.NUMBER,
        allowNull: false,
    },
    transition_type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    motion_effect:{
        type: DataTypes.STRING,
        allowNull: false
    },
    createdAt:{
        type: DataTypes.DATE,
        allowNull: false
    },
    updatedAt:{
        type: DataTypes.DATE,
        allowNull: false
    }
      
},{
    sequelize,
    tableName: "video",
    timestamps: true
})