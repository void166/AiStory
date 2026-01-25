import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface UserAttributes{
    id: string;
    email: string;
    password: string;
}

interface UserCreationAttributes extends Optional<UserAttributes, "id">{}

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes{
    declare id: string;
    declare email: string;
    declare password: string;
}

User.init({
    id:{
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    email:{
        type: DataTypes.STRING,
        allowNull: false
    },
    password:{
        type: DataTypes.STRING,
        allowNull: false,
    }
},{
    sequelize,
    tableName: "user",
    timestamps: true
})