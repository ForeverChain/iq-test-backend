import { mysqlTable, int, varchar, text, decimal, timestamp, mysqlEnum, boolean } from "drizzle-orm/mysql-core";

/* ================= USERS ================= */
export const users = mysqlTable("users", {
    id: int("id").primaryKey().autoincrement(),
    username: varchar("username", { length: 255 }).notNull().unique(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"),
    role: mysqlEnum("role", ["user", "admin"]).default("user"),
    createdAt: timestamp("created_at").defaultNow(),
});

/* ================= QUESTIONS ================= */
export const questions = mysqlTable("questions", {
    id: int("id").primaryKey().autoincrement(),
    testId: int("test_id")
        .notNull()
        .references(() => tests.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    imageUrl: varchar("image_url", { length: 500 }),

    questionType: mysqlEnum("question_type", ["multiple_choice", "short_answer", "numeric", "grid"]).notNull().default("multiple_choice"),

    correctAnswer: varchar("correct_answer", { length: 255 }),
    gridData: text("grid_data"),
    difficulty: int("difficulty").default(1),
    questionOrder: int("question_order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
});

/* ================= QUESTION IMAGES ================= */
export const questionImages = mysqlTable("question_images", {
    id: int("id").primaryKey().autoincrement(),
    questionId: int("question_id")
        .notNull()
        .references(() => questions.id, { onDelete: "cascade" }),
    imageUrl: varchar("image_url", { length: 500 }).notNull(),
    imageOrder: int("image_order").default(0),
});

/* ================= OPTIONS ================= */
export const questionOptions = mysqlTable("question_options", {
    id: int("id").primaryKey().autoincrement(),
    questionId: int("question_id")
        .notNull()
        .references(() => questions.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 32 }),
    optionText: varchar("option_text", { length: 500 }),
    imageUrl: varchar("image_url", { length: 500 }),
    isCorrect: boolean("is_correct").default(false),
});

/* ================= TESTS ================= */
export const tests = mysqlTable("tests", {
    id: int("id").primaryKey().autoincrement(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    durationMinutes: int("duration_minutes"),
    published: boolean("published").default(false),
    createdAt: timestamp("created_at").defaultNow(),
});

/* ================= RESULTS ================= */
export const testResults = mysqlTable("test_results", {
    id: int("id").primaryKey().autoincrement(),
    userId: int("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    testId: int("test_id").references(() => tests.id, {
        onDelete: "set null",
    }),
    score: int("score").notNull(),
    totalQuestions: int("total_questions").notNull(),
    iqScore: int("iq_score").notNull(),
    completedAt: timestamp("completed_at").defaultNow(),
});

/* ================= USER ANSWERS ================= */
export const userAnswers = mysqlTable("user_answers", {
    id: int("id").primaryKey().autoincrement(),
    testResultId: int("test_result_id")
        .notNull()
        .references(() => testResults.id, { onDelete: "cascade" }),
    questionId: int("question_id")
        .notNull()
        .references(() => questions.id, { onDelete: "cascade" }),

    selectedOptionId: int("selected_option_id").references(() => questionOptions.id),

    answerText: varchar("answer_text", { length: 255 }),
    isCorrect: boolean("is_correct").notNull(),
});

/* ================= TRANSACTIONS ================= */
export const transactions = mysqlTable("transactions", {
    id: int("id").primaryKey().autoincrement(),
    senderId: int("sender_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
    receiverId: int("receiver_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["pending", "completed", "failed"]).default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
});
