module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0B0B",
        accent: "#00FFC6",
        ember: "#FF7A00"
      },
      borderRadius: {
        glass: "24px"
      },
      boxShadow: {
        glow: "0 0 40px rgba(0,255,198,0.22)"
      },
      backdropBlur: {
        glass: "22px"
      }
    }
  },
  plugins: []
};