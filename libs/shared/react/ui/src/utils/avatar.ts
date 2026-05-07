const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

export const getPlaceholderImageUrl = (name?: string): string => {
  const backgroundColors = ['BFDFFF', 'BFEAFF', 'CFBFFF', 'FFBFC3', 'FFEABF', 'E3E6EA', 'EAEAEA'];

  const seed = name?.trim() || 'avatar';

  const colorIndex = hashString(seed) % backgroundColors.length;
  const backgroundColor = backgroundColors[colorIndex];

  return `https://api.dicebear.com/9.x/micah/svg?backgroundColor=${backgroundColor}&seed=${encodeURIComponent(seed)}`;
};

export const getInitial = (name?: string): string => {
  if (name) {
    return name.trim()[0]?.toUpperCase() ?? 'L';
  }
  return 'L';
};
