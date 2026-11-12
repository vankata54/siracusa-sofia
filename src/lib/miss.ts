/* NOT in consts.ts: consts.ts is part of the shared runtime (size budget). */
/** The [ЛИПСВА] marks: one key = one text on every page (site.review-consistency, Дребни 1). Render with miss(key) (lib/ui.ts). */
export const MISS = {
  minOrder: "минимална поръчка в €",
  packaging: "опаковка в €",
  fee: "такса в €",
  parking: "паркиране",
  capacity: "капацитет",
  earlyDays: "колко дни по-рано",
  greek: "програма, меню и цена",
  cardTerminal: "терминал за карти в колата",
  stampRule: "за какво се дава печат",
  stampReward: "наградата",
  vouchers: "името на ваучерите",
  photo: "снимка",
  price: "цена или вход свободен",
} as const;
export type MissKey = keyof typeof MISS;

