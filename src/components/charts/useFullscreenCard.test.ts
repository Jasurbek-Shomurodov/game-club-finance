import { describe, expect, it } from 'vitest';
import { inertOutside, type InertTarget } from './useFullscreenCard';

/** A bare element tree: enough of the DOM for `inertOutside`. */
function node(tagName = 'DIV', attributes: string[] = []): InertTarget & { children: InertTarget[] } {
  return { parentElement: null, children: [], inert: false, tagName, hasAttribute: (name) => attributes.includes(name) };
}
function append(parent: InertTarget & { children: InertTarget[] }, ...children: InertTarget[]) {
  for (const child of children) {
    child.parentElement = parent;
    parent.children.push(child);
  }
  return parent;
}

describe('inertOutside', () => {
  // body > [nav, main > [header, section > [other card, the card]], live region, script]
  const build = () => {
    const body = node('BODY');
    const nav = node('NAV');
    const main = node('MAIN');
    const header = node('HEADER');
    const section = node('SECTION');
    const other = node();
    const card = node('SECTION');
    const live = node('DIV', ['aria-live']);
    const script = node('SCRIPT');
    const alreadyInert = node();
    alreadyInert.inert = true;
    append(body, nav, main, live, script, alreadyInert);
    append(main, header, section);
    append(section, other, card);
    return { body, nav, main, header, section, other, card, live, script, alreadyInert };
  };

  it('makes everything beside the card and its ancestors inert, and undoes exactly that', () => {
    const tree = build();
    const { restore } = inertOutside(tree.card, tree.body);
    expect([tree.nav.inert, tree.header.inert, tree.other.inert]).toEqual([true, true, true]);
    // The card and the elements holding it stay usable, as do live regions and non-content tags.
    expect([tree.card.inert, tree.section.inert, tree.main.inert, tree.live.inert, tree.script.inert]).toEqual([false, false, false, false, false]);

    restore();
    expect([tree.nav.inert, tree.header.inert, tree.other.inert]).toEqual([false, false, false]);
    // An element inert before the card opened stays inert.
    expect(tree.alreadyInert.inert).toBe(true);
  });

  it('leaves a dialog added to the body alone, and makes shell content mounted later inert until restore', () => {
    const tree = build();
    const shell = inertOutside(tree.card, tree.body);
    // Dialogs portal to the body, which is not watched.
    expect(shell.watched).toEqual([tree.section, tree.main]);
    const dialog = node();
    append(tree.body, dialog);
    expect(dialog.inert).toBe(false);

    // A banner mounting beside the header, as the observer reports it.
    const banner = node();
    append(tree.main, banner);
    shell.add(banner);
    expect(banner.inert).toBe(true);
    // The card and the elements holding it are never made inert.
    shell.add(tree.card);
    shell.add(tree.section);
    expect([tree.card.inert, tree.section.inert]).toEqual([false, false]);

    shell.restore();
    expect([banner.inert, dialog.inert, tree.nav.inert]).toEqual([false, false, false]);
  });
});
