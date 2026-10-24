// True in the Windows desktop build. Both translation models ship inside the
// app, nothing is fetched from the internet, and no service worker is needed.
export const IS_DESKTOP = process.env.NEXT_PUBLIC_DESKTOP === "true";
