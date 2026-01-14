import express from "express";
import { db } from "../db/index.js";
import { questions, testResults, userAnswers, tests, questionOptions } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Get random questions for test (20 questions)
router.get("/questions", authMiddleware, async (req, res) => {
    try {
        const allQuestions = await db
            .select({
                id: questions.id,
                questionText: questions.questionText,
                imageUrl: questions.imageUrl,
            })
            .from(questions);

        // Shuffle and take 20 questions
        const shuffled = allQuestions.sort(() => Math.random() - 0.5);
        const selectedQuestions = shuffled.slice(0, 20);

        // Fetch options for selected questions
        const questionIds = selectedQuestions.map((q) => q.id);
        const allOptions = await db.select().from(questionOptions);
        const optionsMap = new Map();
        allOptions.forEach((opt) => {
            const arr = optionsMap.get(opt.questionId) || [];
            arr.push({ label: opt.label, optionText: opt.optionText });
            optionsMap.set(opt.questionId, arr);
        });
        // Attach options (without revealing which is correct)
        const selectedWithOptions = selectedQuestions.map((q) => ({
            ...q,
            options: optionsMap.get(q.id) || [],
        }));

        // Try to get a published test to read duration and totalQuestions
        const allTests = await db.select().from(tests);
        const test = (allTests && allTests.find((t) => t.published === 1)) || (allTests && allTests[0]) || null;
        const durationMinutes = test ? test.durationMinutes : null;
        const totalQuestions = test ? test.totalQuestions : selectedQuestions.length;

        res.json({ durationMinutes, totalQuestions, questions: selectedWithOptions });
    } catch (error) {
        console.error("Get questions error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Submit test answers
router.post("/submit", authMiddleware, async (req, res) => {
    try {
        const { answers } = req.body; // Array of { questionId, selectedAnswer }

        if (!answers || !Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({ error: "Хариултууд шаардлагатай" });
        }

        let correctCount = 0;
        const totalQuestions = answers.length;

        // Get correct answers for all questions via questionOptions
        const optionsData = await db.select().from(questionOptions);
        const correctMap = new Map();
        optionsData.forEach((o) => {
            if (o.isCorrect) correctMap.set(o.questionId, o.label);
        });

        // Calculate score
        const answerResults = answers.map((answer) => {
            const correctAnswer = correctMap.get(answer.questionId);
            const isCorrect = answer.selectedAnswer === correctAnswer;
            if (isCorrect) correctCount++;
            return {
                questionId: answer.questionId,
                selectedAnswer: answer.selectedAnswer,
                isCorrect: isCorrect ? 1 : 0,
            };
        });

        // Calculate IQ score (simplified formula)
        // Base IQ is 100, each correct answer adds/subtracts from this
        const percentage = (correctCount / totalQuestions) * 100;
        let iqScore;
        if (percentage >= 90) iqScore = 130 + Math.floor((percentage - 90) * 2);
        else if (percentage >= 75) iqScore = 115 + Math.floor((percentage - 75) * 1);
        else if (percentage >= 50) iqScore = 100 + Math.floor((percentage - 50) * 0.6);
        else if (percentage >= 25) iqScore = 85 + Math.floor((percentage - 25) * 0.6);
        else iqScore = 70 + Math.floor(percentage * 0.6);

        // Save test result
        const testResultInsert = await db.insert(testResults).values({
            userId: req.user.id,
            score: correctCount,
            totalQuestions,
            iqScore,
        });

        const testResultId = testResultInsert[0].insertId;

        // Save individual answers
        for (const answer of answerResults) {
            await db.insert(userAnswers).values({
                testResultId,
                questionId: answer.questionId,
                selectedAnswer: answer.selectedAnswer,
                isCorrect: answer.isCorrect,
            });
        }

        res.json({
            message: "Тест амжилттай илгээгдлээ",
            result: {
                id: testResultId,
                score: correctCount,
                totalQuestions,
                iqScore,
                percentage: Math.round(percentage),
            },
        });
    } catch (error) {
        console.error("Submit test error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get user's test history
router.get("/history", authMiddleware, async (req, res) => {
    try {
        const results = await db.select().from(testResults).where(eq(testResults.userId, req.user.id)).orderBy(desc(testResults.completedAt));

        res.json(results);
    } catch (error) {
        console.error("Get history error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

// Get specific test result with answers
router.get("/result/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db
            .select()
            .from(testResults)
            .where(eq(testResults.id, parseInt(id)));

        if (result.length === 0) {
            return res.status(404).json({ error: "Тест олдсонгүй" });
        }

        if (result[0].userId !== req.user.id && req.user.role !== "admin") {
            return res.status(403).json({ error: "Хандах эрхгүй" });
        }

        const answers = await db
            .select({
                questionId: userAnswers.questionId,
                selectedAnswer: userAnswers.selectedAnswer,
                isCorrect: userAnswers.isCorrect,
                questionText: questions.questionText,
            })
            .from(userAnswers)
            .innerJoin(questions, eq(userAnswers.questionId, questions.id))
            .where(eq(userAnswers.testResultId, parseInt(id)));

        // Attach options and correct answer label to each answer
        const opts = await db.select().from(questionOptions);
        const optsMap = new Map();
        opts.forEach((o) => {
            const arr = optsMap.get(o.questionId) || [];
            arr.push({ label: o.label, optionText: o.optionText, isCorrect: o.isCorrect });
            optsMap.set(o.questionId, arr);
        });
        const answersWithOptions = answers.map((a) => {
            const options = (optsMap.get(a.questionId) || []).map((o) => ({ label: o.label, optionText: o.optionText }));
            const correct = (optsMap.get(a.questionId) || []).find((o) => o.isCorrect);
            return { ...a, options, correctAnswer: correct ? correct.label : null };
        });

        res.json({
            ...result[0],
            answers: answersWithOptions,
        });
    } catch (error) {
        console.error("Get result error:", error);
        res.status(500).json({ error: "Серверийн алдаа" });
    }
});

export default router;
