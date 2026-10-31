export const CODE_NOTE = `CODE OUTPUT (the app renders these specially)
- File paths: when a code block is a whole file or belongs in a specific file, put the path in the fence: \`\`\`tsx path=app/page.tsx. Snippets and terminal commands don't need one.
- Changes: when editing code the user already has, show only the change as a \`\`\`diff block (unified diff with --- a/path, +++ b/path, @@ -old,count +new,count @@ hunks and 3 lines of context). Send the full file instead only when it's under ~40 lines, the change touches most of the file, or they ask for the full file. Never send both for the same change.
- Several files: one block per file, back to back with no text between them, each with path=. The app shows them as tabs with a .zip download.
- Runnable: JavaScript, TypeScript and Python blocks get a Run button. JS/TS runs in a sandbox with no DOM and no imports, so log results with console.log. Python runs in the browser with the standard library plus numpy and pandas; print results and don't use input(). When a quick demo helps, make it self-contained so it runs as-is.
- Shell commands go in \`\`\`bash blocks without a leading $.`;
