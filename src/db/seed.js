import { db } from "./index.js"; // таны db холболт
import { users, questions, tests, questionOptions } from "./schema.js"; // таны schema файл
import bcrypt from "bcryptjs";

// IQ тестийн асуултууд
const iqQuestions = [
    {
        questionText: "Хэрэв 2 + 3 = 10, 7 + 2 = 63, 6 + 5 = 66, 8 + 4 = ?",
        options: [
            { label: "A", optionText: "96", isCorrect: 0 },
            { label: "B", optionText: "32", isCorrect: 0 },
            { label: "C", optionText: "12", isCorrect: 0 },
            { label: "D", optionText: "108", isCorrect: 1 },
        ],
    },
    {
        questionText: "Дараах дарааллын дараагийн тоо юу вэ? 2, 6, 12, 20, 30, ?",
        options: [
            { label: "A", optionText: "40", isCorrect: 0 },
            { label: "B", optionText: "42", isCorrect: 1 },
            { label: "C", optionText: "38", isCorrect: 0 },
            { label: "D", optionText: "44", isCorrect: 0 },
        ],
    },
];

async function seed() {
    try {
        console.log("🌱 Seeding database...");

        // Admin хэрэглэгч үүсгэх
        const adminPassword = await bcrypt.hash("admin123", 10);
        await db.insert(users).values({
            username: "admin",
            email: "admin@iqtest.com",
            password: adminPassword,
            role: "admin",
            balance: 1000.0,
        });
        console.log("✅ Admin user created");

        // Тест хэрэглэгч үүсгэх
        const userPassword = await bcrypt.hash("user123", 10);
        await db.insert(users).values({
            username: "testuser",
            email: "user@iqtest.com",
            password: userPassword,
            role: "user",
            balance: 100.0,
        });
        console.log("✅ Test user created");

        // Create a default test first
        const testInsert = await db.insert(tests).values({
            slug: "default-iq-test",
            title: "Default IQ Test",
            description: "Auto-generated IQ test",
            durationMinutes: 15,
            published: 1,
        });

        const testId = testInsert[0] && testInsert[0].insertId ? testInsert[0].insertId : null;
        if (!testId) {
            console.error("❌ Test creation failed");
            process.exit(1);
        }
        console.log(`✅ Test created with ID: ${testId}`);

        // Асуултууд болон тэдгээрийн сонголтуудыг суулгах (testId-тай)
        for (let i = 0; i < iqQuestions.length; i++) {
            const question = iqQuestions[i];
            const qInsert = await db.insert(questions).values({
                testId: testId,
                questionText: question.questionText,
                imageUrl: question.imageUrl || null,
                questionOrder: i + 1,
            });
            const qId = qInsert[0] && qInsert[0].insertId ? qInsert[0].insertId : null;
            if (qId && Array.isArray(question.options)) {
                for (const opt of question.options) {
                    await db.insert(questionOptions).values({
                        questionId: qId,
                        label: opt.label,
                        optionText: opt.optionText,
                        isCorrect: opt.isCorrect ? 1 : 0,
                    });
                }
            }
        }
        console.log(`✅ ${iqQuestions.length} questions and options inserted`);

        console.log("🎉 Seeding completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

seed();
