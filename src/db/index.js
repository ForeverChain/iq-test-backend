import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import * as schema from "./schema.js";

dotenv.config();

const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

export const db = drizzle(pool, { schema, mode: "default" });

export async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log("✅ Database connected successfully");
        connection.release();
        return true;
    } catch (error) {
        console.error("❌ Database connection failed:", error.message);
        return false;
    }
}
