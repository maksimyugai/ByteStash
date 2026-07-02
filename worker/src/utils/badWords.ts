import { Filter } from 'bad-words';

class BadWordsChecker {
  private filter = new Filter();

  containsBadWords(text: string): boolean {
    if (!text) return false;
    return this.filter.isProfane(text);
  }

  findBadWords(text: string): string[] {
    if (!text) return [];

    const found = new Set<string>();
    const lowerText = text.toLowerCase();

    for (const badWord of this.filter.list) {
      // Word boundaries to match whole words only
      const regex = new RegExp(`\\b${this.escapeRegex(badWord)}\\b`, 'i');
      if (regex.test(lowerText)) {
        found.add(badWord);
      }
    }

    return Array.from(found);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default new BadWordsChecker();
