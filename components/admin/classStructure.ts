export const parseClassSections = (value: string): string[] => {
    const sections = value
        .split(/[,،]/)
        .map(section => section.trim())
        .filter(Boolean);

    return Array.from(new Set(sections));
};
