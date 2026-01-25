import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db.js";

interface VideoAttributes{
    id: string;
    projectId: string;
    status: "processing" | "done" | "failed";
    fileUrl: string;
    progress: number;
    duration: number;
    resolution: string;
}

interface VideoCreationAttributes extends Optional<VideoAttributes, "id">{}

export class Video extends Model<VideoAttributes, VideoCreationAttributes> implements VideoAttributes{
    declare id: string;
    declare projectId: string;
    declare status: "processing" | "done" | "failed";
    declare fileUrl: string;
    declare progress: number;
    declare duration: number;
    declare resolution: string;
}

Video.init({
    id:{
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    projectId:{
        type: DataTypes.UUID,
        allowNull: false
    },
    status:{
        type: DataTypes.ENUM("processing" ,"done" , "failed"),
        allowNull: false,
    },
    fileUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    progress:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    duration:{
        type: DataTypes.FLOAT,
        allowNull: false
    },
    resolution: {
        type: DataTypes.STRING,
        allowNull: false
    }
},{
    sequelize,
    tableName: "video",
    timestamps: true
})