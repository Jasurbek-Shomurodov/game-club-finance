import { buildOwnerBotCallbackData } from './callbackData';
import type { OwnerBotDayView } from './dayView';
import { BUTTON_TEXT, methodButtonText, undoButtonText } from './texts';

/** Telegram's InlineKeyboardMarkup with callback buttons only. */
export interface OwnerBotInlineButton {
  text: string;
  callback_data: string;
}
export interface OwnerBotKeyboard {
  inline_keyboard: OwnerBotInlineButton[][];
}

/** Buttons per row on the day message, so method names stay readable on a phone. */
const METHODS_PER_ROW = 2;

function inRows<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/**
 * The day message: one button per line that still has money in the till and
 * no mark, then the undo of the owner's last mark while it is valid. Null
 * when there is nothing to press (the message is sent or edited without a
 * keyboard).
 */
export function dayKeyboard(view: OwnerBotDayView): OwnerBotKeyboard | null {
  const methods = view.lines
    .filter((line) => line.status === 'open' && line.buttonId)
    .map((line) => ({ text: methodButtonText(line.method), callback_data: buildOwnerBotCallbackData('menu', line.buttonId!) }));
  const rows = inRows(methods, METHODS_PER_ROW);
  if (view.undo) {
    rows.push([{ text: undoButtonText(view.undo), callback_data: buildOwnerBotCallbackData('undo', view.undo.handoverId) }]);
  }
  return rows.length > 0 ? { inline_keyboard: rows } : null;
}

/** After a method's button: what happened to it. */
export function methodMenuKeyboard(lineId: string): OwnerBotKeyboard {
  return {
    inline_keyboard: [
      [
        { text: BUTTON_TEXT.collect, callback_data: buildOwnerBotCallbackData('collect', lineId) },
        { text: BUTTON_TEXT.reserve, callback_data: buildOwnerBotCallbackData('reserve', lineId) },
      ],
      [{ text: BUTTON_TEXT.back, callback_data: buildOwnerBotCallbackData('back', lineId) }],
    ],
  };
}

/** The confirmation of one choice; nothing is saved before ✅ Да. */
export function confirmKeyboard(choiceId: string): OwnerBotKeyboard {
  return {
    inline_keyboard: [[
      { text: BUTTON_TEXT.yes, callback_data: buildOwnerBotCallbackData('yes', choiceId) },
      { text: BUTTON_TEXT.no, callback_data: buildOwnerBotCallbackData('no', choiceId) },
    ]],
  };
}
