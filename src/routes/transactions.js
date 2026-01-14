import express from "express";
import { body, validationResult } from "express-validator";
import { db } from "../db/index.js";
import { transactions, users } from "../db/schema.js";
import { eq, desc, or, sql } from "drizzle-orm";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Get user's balance
router.get("/balance", authMiddleware, async (req, res) => {
    try {
        const userResult = await db.select({ balance: users.balance }).from(users).where(eq(users.id, req.user.id));

        if (userResult.length === 0) {
            return res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
        }

        res.json({ balance: userResult[0].balance });
    } catch (error) {
        console.error("Get balance error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Create transfer (pending status)
router.post("/transfer", authMiddleware, [body("receiverId").isInt().withMessage("Хүлээн авагчийн ID буруу"), body("amount").isFloat({ min: 0.01 }).withMessage("Дүн 0-ээс их байх ёстой")], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { receiverId, amount } = req.body;
        const senderId = req.user.id;

        if (senderId === parseInt(receiverId)) {
            return res.status(400).json({ error: "Өөртөө шилжүүлэг хийх боломжгүй" });
        }

        // Check if receiver exists
        const receiver = await db
            .select()
            .from(users)
            .where(eq(users.id, parseInt(receiverId)));

        if (receiver.length === 0) {
            return res.status(404).json({ error: "Хүлээн авагч олдсонгүй" });
        }

        // Check sender balance
        const sender = await db.select().from(users).where(eq(users.id, senderId));

        if (parseFloat(sender[0].balance) < parseFloat(amount)) {
            return res.status(400).json({ error: "Үлдэгдэл хүрэлцэхгүй байна" });
        }

        // Create transaction with pending status
        const result = await db.insert(transactions).values({
            senderId,
            receiverId: parseInt(receiverId),
            amount: amount.toString(),
            status: "pending",
        });

        res.status(201).json({
            message: "Шилжүүлэг үүсгэгдлээ. Админ баталгаажуулахыг хүлээнэ үү.",
            transactionId: result[0].insertId,
        });
    } catch (error) {
        console.error("Create transfer error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get user's transaction history
router.get("/history", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const transactionList = await db
            .select({
                id: transactions.id,
                senderId: transactions.senderId,
                receiverId: transactions.receiverId,
                amount: transactions.amount,
                status: transactions.status,
                createdAt: transactions.createdAt,
            })
            .from(transactions)
            .where(or(eq(transactions.senderId, userId), eq(transactions.receiverId, userId)))
            .orderBy(desc(transactions.createdAt));

        // Get usernames for sender and receiver
        const usersData = await db
            .select({
                id: users.id,
                username: users.username,
            })
            .from(users);

        const usersMap = new Map(usersData.map((u) => [u.id, u.username]));

        const enrichedTransactions = transactionList.map((t) => ({
            ...t,
            senderUsername: usersMap.get(t.senderId),
            receiverUsername: usersMap.get(t.receiverId),
            type: t.senderId === userId ? "sent" : "received",
        }));

        res.json(enrichedTransactions);
    } catch (error) {
        console.error("Get transaction history error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Admin: Get all transactions
router.get("/admin/all", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const transactionList = await db.select().from(transactions).orderBy(desc(transactions.createdAt));

        // Get usernames for sender and receiver
        const usersData = await db
            .select({
                id: users.id,
                username: users.username,
            })
            .from(users);

        const usersMap = new Map(usersData.map((u) => [u.id, u.username]));

        const enrichedTransactions = transactionList.map((t) => ({
            ...t,
            senderUsername: usersMap.get(t.senderId),
            receiverUsername: usersMap.get(t.receiverId),
        }));

        res.json(enrichedTransactions);
    } catch (error) {
        console.error("Admin get transactions error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Admin: Update transaction status
router.patch("/admin/:id/status", authMiddleware, adminMiddleware, [body("status").isIn(["completed", "failed"]).withMessage("Статус буруу")], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { status } = req.body;

        // Get transaction
        const transaction = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, parseInt(id)));

        if (transaction.length === 0) {
            return res.status(404).json({ error: "Шилжүүлэг олдсонгүй" });
        }

        if (transaction[0].status !== "pending") {
            return res.status(400).json({ error: "Зөвхөн хүлээгдэж буй шилжүүлгийг өөрчлөх боломжтой" });
        }

        // If completing, update balances
        if (status === "completed") {
            const { senderId, receiverId, amount } = transaction[0];

            // Check sender balance again
            const sender = await db.select().from(users).where(eq(users.id, senderId));

            if (parseFloat(sender[0].balance) < parseFloat(amount)) {
                return res.status(400).json({ error: "Илгээгчийн үлдэгдэл хүрэлцэхгүй байна" });
            }

            // Deduct from sender
            await db
                .update(users)
                .set({ balance: sql`${users.balance} - ${amount}` })
                .where(eq(users.id, senderId));

            // Add to receiver
            await db
                .update(users)
                .set({ balance: sql`${users.balance} + ${amount}` })
                .where(eq(users.id, receiverId));
        }

        // Update transaction status
        await db
            .update(transactions)
            .set({ status })
            .where(eq(transactions.id, parseInt(id)));

        res.json({
            message: status === "completed" ? "Шилжүүлэг амжилттай баталгаажлаа" : "Шилжүүлэг цуцлагдлаа",
        });
    } catch (error) {
        console.error("Update transaction status error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Search users for transfer
router.get("/users/search", authMiddleware, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.json([]);
        }

        const usersResult = await db
            .select({
                id: users.id,
                username: users.username,
            })
            .from(users)
            .where(sql`${users.username} LIKE ${`%${q}%`}`)
            .limit(10);

        // Filter out current user
        const filteredUsers = usersResult.filter((u) => u.id !== req.user.id);

        res.json(filteredUsers);
    } catch (error) {
        console.error("Search users error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

export default router;
