import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db.js";

interface AssetAttributes{
    id: string;
    projectId: string;
    type: "image" | "audio" | "video"
    fileUrl: string;
    metadata: JSON;
}

interface AssetCreationAttributes extends Optional<AssetAttributes, "id">{}

export class Asset extends Model<AssetAttributes, AssetCreationAttributes> implements AssetAttributes{
    declare id: string;
    declare projectId: string;
    declare type: "image" | "audio" | "video";
    declare fileUrl: string;
    declare metadata: JSON;
}

Asset.init({
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
    type:{
        type: DataTypes.ENUM("image", "audio", "video"),
        allowNull: false,
    },
    fileUrl:{
        type: DataTypes.STRING,
        allowNull: false
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: false
    }
},{
    sequelize,
    tableName: "asset",
    timestamps: true
});
