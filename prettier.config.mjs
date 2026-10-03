// Nothing here sets a Prettier option to a value: restating a default is one more thing to read,
// justify and keep in sync, so this file only carries what actually changes behaviour. `plugins`
// loads the class sorter; `tailwindStylesheet` tells it which stylesheet defines this project's
// Tailwind utilities, which Tailwind v4 requires and which is why the kumo semantic classes sort
// into their proper place instead of being pushed to the front.
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/client/main.css",
};
