/* Tiny lookup hook so code in the shared runtime (routes, cart) can find a dish WITHOUT importing the menu.
   data.ts registers the resolver when a page imports the menu. */
export interface DishRef { id: string; slug?: string; cat: string; n?: string; p?: number; lunch?: boolean }
let resolver: (id: string) => DishRef | undefined = () => undefined;
export function setDishResolver(fn: (id: string) => DishRef | undefined): void { resolver = fn; }
export function resolveDish(id: string): DishRef | undefined { return resolver(id); }
