import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Register
router.post(
    "/register",
    [body("username").isLength({ min: 3 }).withMessage("Хэрэглэгчийн нэр хамгийн багадаа 3 тэмдэгт байх ёстой"), body("email").isEmail().withMessage("Зөв имэйл хаяг оруулна уу"), body("password").isLength({ min: 6 }).withMessage("Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой")],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { username, email, password } = req.body;

            // Check if user exists
            const existingUser = await db.select().from(users).where(eq(users.email, email));

            if (existingUser.length > 0) {
                return res.status(400).json({ error: "Энэ имэйл бүртгэгдсэн байна" });
            }

            const existingUsername = await db.select().from(users).where(eq(users.username, username));

            if (existingUsername.length > 0) {
                return res.status(400).json({ error: "Энэ хэрэглэгчийн нэр бүртгэгдсэн байна" });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Create user
            const result = await db.insert(users).values({
                username,
                email,
                password: hashedPassword,
                balance: "0.00",
                role: "user",
            });

            const newUserId = result[0].insertId;

            // Generate token
            const token = jwt.sign({ id: newUserId, username, email, role: "user" }, process.env.JWT_SECRET, { expiresIn: "7d" });

            res.status(201).json({
                message: "Бүртгэл амжилттай",
                token,
                user: { id: newUserId, username, email, role: "user", balance: "0.00" },
            });
        } catch (error) {
            console.error("Register error:", error);
            res.status(500).json({ error: "Серверийн алдаа" });
        }
    }
);

// Login
router.post("/login", [body("email").isEmail().withMessage("Зөв имэйл хаяг оруулна уу"), body("password").notEmpty().withMessage("Нууц үг оруулна уу")], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Find user
        const userResult = await db.select().from(users).where(eq(users.email, email));

        if (userResult.length === 0) {
            return res.status(401).json({ error: "Имэйл эсвэл нууц үг буруу" });
        }

        const user = userResult[0];

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: "Имэйл эсвэл нууц үг буруу" });
        }

        // Generate token
        const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({
            message: "Нэвтрэлт амжилттай",
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                balance: user.balance,
            },
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get current user
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const userResult = await db.select().from(users).where(eq(users.id, req.user.id));

        if (userResult.length === 0) {
            return res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
        }

        const user = userResult[0];
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            balance: user.balance,
        });
    } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

export default router;
