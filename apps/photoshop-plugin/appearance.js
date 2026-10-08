// PhotoGit uses one dark appearance in Photoshop and the browser preview.
// Ignore and remove the old preference so previous light-mode users migrate.
document.documentElement.setAttribute("data-theme", "dark");
try { localStorage.removeItem("photogit.appearance"); } catch { /* Appearance does not depend on storage. */ }
