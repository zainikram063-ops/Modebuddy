import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export function makeStudyTools(db: SupabaseClient, userId: string, save: boolean) {
  return {
    create_quiz: tool({
      description: "Create an interactive multiple-choice quiz the user answers by clicking. Use whenever the user wants to be quizzed or tested.",
      parameters: z.object({
        title: z.string().max(80).describe("Short topic title, e.g. 'Photosynthesis'"),
        questions: z.array(z.object({
          q: z.string().describe("The question"),
          options: z.array(z.string()).min(2).max(5).describe("Answer options, without A/B/C prefixes"),
          answer: z.number().int().min(0).describe("0-based index of the correct option"),
          explain: z.string().max(300).describe("One or two sentences on why the answer is right"),
        })).min(1).max(10),
      }),
      execute: async ({ title, questions }) => ({
        ok: true,
        title,
        questions: questions.map((x) => ({ ...x, answer: Math.min(Math.max(0, x.answer), x.options.length - 1) })),
      }),
    }),

    create_flashcards: tool({
      description: "Create a flashcard deck the user flips through. It is saved so cards come back for review later. Use when the user asks for flashcards.",
      parameters: z.object({
        title: z.string().max(80).describe("Deck title"),
        cards: z.array(z.object({
          front: z.string().max(200).describe("A short question or term"),
          back: z.string().max(500).describe("A concise answer or definition"),
        })).min(1).max(40),
      }),
      execute: async ({ title, cards }) => {
        if (!save) return { ok: true, title, deckId: null, cards: cards.map((c, i) => ({ id: `tmp-${i}`, ...c })) };
        const { data: deck, error } = await db.from("flashcard_decks").insert({ user_id: userId, title }).select("id").single();
        if (error || !deck) return { ok: false, error: error?.message ?? "Couldn't save the deck." };
        const { data: rows, error: e2 } = await db
          .from("flashcards")
          .insert(cards.map((c) => ({ deck_id: deck.id, user_id: userId, front: c.front, back: c.back })))
          .select("id,front,back");
        if (e2 || !rows) return { ok: false, error: e2?.message ?? "Couldn't save the cards." };
        return { ok: true, title, deckId: deck.id, cards: rows };
      },
    }),

    create_exam: tool({
      description: "Create a timed mock exam the user takes in a full-screen exam view. Use for 'mock exam', 'practice paper' or 'test me properly'.",
      parameters: z.object({
        title: z.string().max(100).describe("Exam title, e.g. 'Biology: Cells · Mock'"),
        minutes: z.number().int().min(5).max(180).describe("Time limit in minutes"),
        questions: z.array(z.object({
          q: z.string().describe("The question"),
          type: z.enum(["mcq", "short"]).describe("mcq = multiple choice, short = written answer"),
          options: z.array(z.string()).max(5).optional().describe("Only for mcq"),
          correct: z.number().int().min(0).optional().describe("Only for mcq: 0-based index of the correct option"),
          answer: z.string().describe("Model answer / mark scheme used for marking"),
          marks: z.number().int().min(1).max(20),
        })).min(1).max(25),
      }),
      execute: async (x) => ({ ok: true, ...x }),
    }),
  };
}
