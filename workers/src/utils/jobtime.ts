export const getJobTime = () => {
  return new Date()
    .toISOString()
    .substring(0, 19)
    .replace(/[-:]/g, "")
    .replace(/T/g, "-");
};
