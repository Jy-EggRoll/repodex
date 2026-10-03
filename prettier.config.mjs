// Only deviations from Prettier's defaults belong here: an option that restates a default is one
// more thing to read, justify and keep in sync. `printWidth` is the sole real deviation.
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  printWidth: 110,
  tailwindStylesheet: "./src/client/main.css",
};
