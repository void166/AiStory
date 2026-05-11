import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface EvaluationAttributes {
  id:           string;
  videoId:      string;

  // AI viral score (0–100 each, plus letter grade)
  overallScore: number;
  grade:        string;          // A+ / A / B+ / B / C / D / F
  hookScore:        number;
  pacingScore:      number;
  emotionScore:     number;
  clarityScore:     number;
  originalityScore: number;

  // Per-scene scores (JSON-serialised array)
  sceneScores:  string | null;   // [{ sceneIndex, score, weakness? }]

  // Plain-text suggestions from the LLM
  suggestions:  string | null;   // JSON array of strings

  // Automatic health-check warnings (no LLM)
  healthIssues: string | null;   // JSON array of { code, message, severity }

  // User-facing feedback
  userRating:   number | null;   // 0–5 stars
  userLiked:    boolean | null;  // true = like, false = dislike, null = no opinion
}

interface EvaluationCreationAttributes
  extends Optional<EvaluationAttributes, "id" | "sceneScores" | "suggestions" | "healthIssues" | "userRating" | "userLiked"> {}

export class Evaluation
  extends Model<EvaluationAttributes, EvaluationCreationAttributes>
  implements EvaluationAttributes
{
  declare id:           string;
  declare videoId:      string;
  declare overallScore: number;
  declare grade:        string;
  declare hookScore:        number;
  declare pacingScore:      number;
  declare emotionScore:     number;
  declare clarityScore:     number;
  declare originalityScore: number;
  declare sceneScores:  string | null;
  declare suggestions:  string | null;
  declare healthIssues: string | null;
  declare userRating:   number | null;
  declare userLiked:    boolean | null;
}

Evaluation.init(
  {
    id: {
      type:         DataTypes.UUID,
      allowNull:    false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey:   true,
    },
    videoId:          { type: DataTypes.UUID,    allowNull: false },
    overallScore:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    grade:            { type: DataTypes.STRING,  allowNull: false, defaultValue: 'C'  },
    hookScore:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    pacingScore:      { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    emotionScore:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    clarityScore:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    originalityScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sceneScores:      { type: DataTypes.TEXT,    allowNull: true  },
    suggestions:      { type: DataTypes.TEXT,    allowNull: true  },
    healthIssues:     { type: DataTypes.TEXT,    allowNull: true  },
    userRating:       { type: DataTypes.FLOAT,   allowNull: true  },
    userLiked:        { type: DataTypes.BOOLEAN, allowNull: true  },
  },
  {
    sequelize,
    tableName:  "evaluations",
    timestamps: true,
  },
);
