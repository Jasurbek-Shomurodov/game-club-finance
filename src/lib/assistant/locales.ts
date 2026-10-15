/** Kept free of message imports so browser code can use it cheaply. */
export const ASSISTANT_LOCALES = ['ru', 'uz', 'en'] as const;
export type AssistantLocale = (typeof ASSISTANT_LOCALES)[number];
