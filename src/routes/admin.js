import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db/index.js";
import { users, testResults, transactions, questions, questionOptions, tests, questionImages } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import fs from "fs";
const fsp = fs.promises;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, "../../uploads/tmp"));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error("Зөвхөн зураг файл оруулна уу"));
        }
    },
});

const router = express.Router();

// Get all users
router.get("/users", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const allUsers = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                balance: users.balance,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .orderBy(desc(users.createdAt));

        res.json(allUsers);
    } catch (error) {
        console.error("Get users error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get user details with stats
router.get("/users/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const user = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                balance: users.balance,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, parseInt(id)));

        if (user.length === 0) {
            return res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
        }

        // Get test count
        const tests = await db
            .select()
            .from(testResults)
            .where(eq(testResults.userId, parseInt(id)));

        res.json({
            ...user[0],
            testCount: tests.length,
            averageIQ: tests.length > 0 ? Math.round(tests.reduce((acc, t) => acc + t.iqScore, 0) / tests.length) : null,
        });
    } catch (error) {
        console.error("Get user details error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Update user balance (admin only)
router.patch("/users/:id/balance", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount } = req.body;

        if (typeof amount !== "number") {
            return res.status(400).json({ error: "Дүн буруу" });
        }

        await db
            .update(users)
            .set({ balance: amount.toString() })
            .where(eq(users.id, parseInt(id)));

        res.json({ message: "Баланс шинэчлэгдлээ" });
    } catch (error) {
        console.error("Update balance error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get dashboard stats
router.get("/stats", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const totalUsers = await db.select({ count: sql`COUNT(*)` }).from(users);

        const totalTests = await db.select({ count: sql`COUNT(*)` }).from(testResults);

        const pendingTransactions = await db
            .select({ count: sql`COUNT(*)` })
            .from(transactions)
            .where(eq(transactions.status, "pending"));

        const totalTransactionVolume = await db
            .select({
                total: sql`COALESCE(SUM(amount), 0)`,
            })
            .from(transactions)
            .where(eq(transactions.status, "completed"));

        res.json({
            totalUsers: totalUsers[0].count,
            totalTests: totalTests[0].count,
            pendingTransactions: pendingTransactions[0].count,
            totalTransactionVolume: totalTransactionVolume[0].total,
        });
    } catch (error) {
        console.error("Get stats error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Helper function to move file from tmp to final destination
function moveImageToFinal(tmpPath) {
    if (!tmpPath || !tmpPath.startsWith("/uploads/tmp/")) {
        return tmpPath; // Already in final location or no image
    }

    const filename = path.basename(tmpPath);
    const tmpFullPath = path.join(__dirname, "../../", tmpPath);
    const finalDir = path.join(__dirname, "../../uploads/questions");
    const finalFullPath = path.join(finalDir, filename);

    // Ensure final directory exists
    if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
    }

    // Move file
    if (fs.existsSync(tmpFullPath)) {
        fs.renameSync(tmpFullPath, finalFullPath);
        return `/uploads/questions/${filename}`;
    }

    return tmpPath; // If file doesn't exist, return original path
}

// Upload image endpoint (uploads to tmp folder)
router.post("/upload-image", authMiddleware, adminMiddleware, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Зураг оруулна уу" });
        }
        const tmpImageUrl = `/uploads/tmp/${req.file.filename}`;
        res.json({ imageUrl: tmpImageUrl, message: "Зураг түр хуулагдлаа" });
    } catch (error) {
        console.error("Upload image error:", error);
        res.status(500).json({ error: error.message || "Зураг хуулахад алдаа гарлаа" });
    }
});

// Create question with options (within a test)
router.post("/questions", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { testId, questionText, imageUrls, options, questionOrder, questionType, correctAnswer, gridData, difficulty } = req.body;

        // Basic validation: require testId and questionText always
        if (!testId || !questionText) {
            return res.status(400).json({ error: "testId болон асуулт шаардлагатай" });
        }

        // For multiple_choice questions, options are required. For other types, correctAnswer is required.
        const qType = questionType || "multiple_choice";
        if (qType === "multiple_choice") {
            if (!options || !Array.isArray(options) || options.length === 0) {
                return res.status(400).json({ error: "multiple_choice төрлийн асуултад сонголтууд шаардлагатай" });
            }
        } else {
            if (!correctAnswer || String(correctAnswer).trim().length === 0) {
                return res.status(400).json({ error: "Энэхүү төрлийн асуултанд зөв хариулт заавал шаардлагатай" });
            }
        }

        // Insert question (imageUrl field kept for backward compatibility but not used)
        // Normalize correctAnswer: if array provided, stringify to store safely
        let insertCorrect = correctAnswer;
        if (Array.isArray(insertCorrect)) {
            insertCorrect = JSON.stringify(insertCorrect);
        } else if (typeof insertCorrect === "object" && insertCorrect !== null) {
            insertCorrect = JSON.stringify(insertCorrect);
        }

        const qInsert = await db.insert(questions).values({
            testId,
            questionText,
            imageUrl: null, // Deprecated, using question_images table now
            questionType: qType,
            correctAnswer: insertCorrect || null,
            gridData: qType === "grid" ? JSON.stringify(gridData) : null,
            difficulty: typeof difficulty !== "undefined" ? difficulty : 2,
            questionOrder: questionOrder || 0,
        });

        const questionId = qInsert[0]?.insertId;
        if (!questionId) {
            return res.status(500).json({ error: "Асуулт үүсгэхэд алдаа гарлаа" });
        }

        // Insert question images if provided
        if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
            for (let i = 0; i < imageUrls.length; i++) {
                const finalImageUrl = moveImageToFinal(imageUrls[i]);
                await db.insert(questionImages).values({
                    questionId,
                    imageUrl: finalImageUrl,
                    imageOrder: i,
                });
            }
        }

        // Insert options (only for multiple_choice)
        if (qType === "multiple_choice" && Array.isArray(options)) {
            for (const opt of options) {
                if (!opt.label || !opt.optionText) continue;
                const finalOptionImageUrl = opt.imageUrl ? moveImageToFinal(opt.imageUrl) : null;
                await db.insert(questionOptions).values({
                    questionId,
                    label: opt.label,
                    optionText: opt.optionText,
                    imageUrl: finalOptionImageUrl,
                    isCorrect: opt.isCorrect ? 1 : 0,
                });
            }
        }

        res.json({ message: "Асуулт амжилттай нэмэгдлээ", questionId });
    } catch (error) {
        console.error("Create question error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get all questions with options (optionally filter by testId)
router.get("/questions", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { testId } = req.query;

        let allQuestions;
        if (testId) {
            allQuestions = await db
                .select()
                .from(questions)
                .where(eq(questions.testId, parseInt(testId)))
                .orderBy(questions.questionOrder, desc(questions.createdAt));
        } else {
            allQuestions = await db.select().from(questions).orderBy(desc(questions.createdAt));
        }

        const allOptions = await db.select().from(questionOptions);
        const allImages = await db.select().from(questionImages);

        const optionsMap = new Map();
        allOptions.forEach((opt) => {
            const arr = optionsMap.get(opt.questionId) || [];
            arr.push({
                id: opt.id,
                label: opt.label,
                optionText: opt.optionText,
                imageUrl: opt.imageUrl,
                isCorrect: opt.isCorrect,
            });
            optionsMap.set(opt.questionId, arr);
        });

        const imagesMap = new Map();
        allImages.forEach((img) => {
            const arr = imagesMap.get(img.questionId) || [];
            arr.push({
                id: img.id,
                imageUrl: img.imageUrl,
                imageOrder: img.imageOrder,
            });
            imagesMap.set(img.questionId, arr);
        });

        const questionsWithOptions = allQuestions.map((q) => ({
            ...q,
            options: optionsMap.get(q.id) || [],
            images: (imagesMap.get(q.id) || []).sort((a, b) => a.imageOrder - b.imageOrder),
            gridData: q.gridData
                ? (() => {
                      try {
                          return JSON.parse(q.gridData);
                      } catch (e) {
                          return null;
                      }
                  })()
                : null,
        }));

        res.json(questionsWithOptions);
    } catch (error) {
        console.error("Get questions error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Tests CRUD for admin
router.get("/tests", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const allTests = await db.select().from(tests).orderBy(desc(tests.createdAt));

        // Count questions for each test
        for (const test of allTests) {
            const questionCount = await db
                .select({ count: sql`COUNT(*)` })
                .from(questions)
                .where(eq(questions.testId, test.id));
            test.totalQuestions = questionCount[0].count;
        }

        res.json(allTests);
    } catch (error) {
        console.error("Get tests error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

router.post("/tests", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { slug, title, description, durationMinutes, published } = req.body;
        if (!slug || !title) return res.status(400).json({ error: "slug болон title шаардлагатай" });

        const insert = await db.insert(tests).values({
            slug,
            title,
            description: description || null,
            durationMinutes: durationMinutes || null,
            published: published ? 1 : 0,
        });

        const testId = insert[0]?.insertId;
        res.json({ message: "Test created", testId });
    } catch (error) {
        console.error("Create test error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

router.patch("/tests/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        await db
            .update(tests)
            .set(updates)
            .where(eq(tests.id, parseInt(id)));
        res.json({ message: "Test updated" });
    } catch (error) {
        console.error("Update test error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

router.delete("/tests/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        // Questions will be cascade deleted
        await db.delete(tests).where(eq(tests.id, parseInt(id)));
        res.json({ message: "Test deleted" });
    } catch (error) {
        console.error("Delete test error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Delete question
router.delete("/questions/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await db.delete(questions).where(eq(questions.id, parseInt(id)));
        res.json({ message: "Асуулт амжилттай устгагдлаа" });
    } catch (error) {
        console.error("Delete question error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Update question (replace options and images)
router.patch("/questions/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { questionText, imageUrls, options, questionType, correctAnswer, difficulty, gridData } = req.body;

        if (!questionText) {
            return res.status(400).json({ error: "Асуулт шаардлагатай" });
        }

        const qType = questionType || "multiple_choice";
        if (qType === "multiple_choice") {
            if (!options || !Array.isArray(options) || options.length === 0) {
                return res.status(400).json({ error: "multiple_choice төрлийн асуултад сонголтууд шаардлагатай" });
            }
        } else {
            if (!correctAnswer || String(correctAnswer).trim().length === 0) {
                return res.status(400).json({ error: "Энэхүү төрлийн асуултанд зөв хариулт заавал шаардлагатай" });
            }
        }

        // Update question core fields
        // Normalize correctAnswer for update too
        let updateCorrect = correctAnswer;
        if (Array.isArray(updateCorrect)) {
            updateCorrect = JSON.stringify(updateCorrect);
        } else if (typeof updateCorrect === "object" && updateCorrect !== null) {
            updateCorrect = JSON.stringify(updateCorrect);
        }

        await db
            .update(questions)
            .set({
                questionText,
                difficulty: typeof difficulty !== "undefined" ? difficulty : 2,
                questionType: qType,
                correctAnswer: updateCorrect || null,
                gridData: gridData ? JSON.stringify(gridData) : null,
            })
            .where(eq(questions.id, parseInt(id)));

        // Remove existing images and options
        await db.delete(questionImages).where(eq(questionImages.questionId, parseInt(id)));
        await db.delete(questionOptions).where(eq(questionOptions.questionId, parseInt(id)));

        // Ensure question still exists before inserting child rows
        const existsRes = await db
            .select({ count: sql`COUNT(*)` })
            .from(questions)
            .where(eq(questions.id, parseInt(id)));
        if (!existsRes || existsRes[0].count === 0) {
            return res.status(404).json({ error: "Question not found" });
        }

        // Insert new images (move from tmp to final if needed)
        if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
            for (let i = 0; i < imageUrls.length; i++) {
                const finalImageUrl = moveImageToFinal(imageUrls[i]);
                await db.insert(questionImages).values({ questionId: parseInt(id), imageUrl: finalImageUrl, imageOrder: i });
            }
        }

        // Insert new options (only for multiple_choice)
        if (qType === "multiple_choice" && Array.isArray(options)) {
            for (const opt of options) {
                if (!opt.label || !opt.optionText) continue;
                const finalOptionImageUrl = opt.imageUrl ? moveImageToFinal(opt.imageUrl) : null;
                await db.insert(questionOptions).values({ questionId: parseInt(id), label: opt.label, optionText: opt.optionText, imageUrl: finalOptionImageUrl, isCorrect: opt.isCorrect ? 1 : 0 });
            }
        }

        res.json({ message: "Асуулт амжилттай шинэчлэгдлээ" });
    } catch (error) {
        console.error("Update question error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Auto-cleanup old temp files (runs every 30 minutes)
const TMP_DIR = path.join(__dirname, "../../uploads/tmp");
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
const MAX_AGE = 60 * 60 * 1000; // 1 hour

setInterval(async () => {
    try {
        await fsp.access(TMP_DIR).catch(() => null);
        const files = await fsp.readdir(TMP_DIR);

        let deletedCount = 0;

        for (const file of files) {
            const fullPath = path.join(TMP_DIR, file);
            const stat = await fsp.stat(fullPath);

            if (Date.now() - stat.mtimeMs > MAX_AGE) {
                await fsp.unlink(fullPath);
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            console.log(`🧹 Cleaned ${deletedCount} old temp file(s)`);
        }
    } catch (err) {
        console.error("Temp cleanup error:", err);
    }
}, CLEANUP_INTERVAL);

// Initial cleanup on server start
setTimeout(() => {
    try {
        if (!fs.existsSync(TMP_DIR)) return;
        const files = fs.readdirSync(TMP_DIR);
        files.forEach((file) => {
            const fullPath = path.join(TMP_DIR, file);
            const stat = fs.statSync(fullPath);
            if (Date.now() - stat.mtimeMs > MAX_AGE) {
                fs.unlinkSync(fullPath);
            }
        });
        console.log("✅ Initial temp cleanup completed");
    } catch (error) {
        console.error("Initial cleanup error:", error);
    }
}, 5000); // 5 seconds after server start

export default router;
