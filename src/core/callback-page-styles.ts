export const CALLBACK_PAGE_STYLES = `
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: dark; background: #242731; }
body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 1rem;
  line-height: 1.5;
  color: #d3d4d6;
}
main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100svh;
  padding: 2.5rem 1rem;
  background: #242731;
}
.frame { width: 100%; max-width: 28rem; }
.brand { display: flex; justify-content: center; padding-bottom: 2rem; }
.logo { display: block; width: 240px; max-width: 100%; height: auto; }
.card {
  background: #1a1d1f;
  border: 1px solid #3a3d46;
  border-radius: 0.5rem;
  padding: 2rem;
  text-align: center;
}
.status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: 0 auto 1rem;
  border-radius: 50%;
}
.status svg { width: 20px; height: 20px; }
.status-success { background: #45b26b; color: #ffffff; }
.status-failure { background: #ff754c; color: #1a1d1f; }
h1 {
  margin: 0;
  font-family: 'DM Sans', 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  text-wrap: balance;
  color: #ffffff;
}
p { margin: 1rem 0 0; text-wrap: pretty; }
.detail { color: #a7a9ad; }
code { font-family: inherit; font-weight: 500; color: #ffffff; }
`;
