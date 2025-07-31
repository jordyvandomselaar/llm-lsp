# Troubleshooting

## Inlay Hints Not Showing

If inlay hints are not appearing:

1. **Check VS Code Settings**:
   - Open VS Code settings (Cmd/Ctrl + ,)
   - Search for "inlay hints"
   - Ensure "Editor > Inlay Hints: Enabled" is set to "on" or "onUnlessPressed"
   - For TypeScript/JavaScript specifically, ensure inlay hints are enabled

2. **Check Extension Output**:
   - Open the Output panel (View > Output)
   - Select "LLM LSP" from the dropdown
   - Look for error messages or API key warnings

3. **Verify API Key**:
   - Ensure you have set your OpenRouter API key either:
     - In VS Code settings: `llmLsp.openRouterApiKey`
     - Or as environment variable: `OPENROUTER_API_KEY`

4. **Test with Simple Example**:
   ```javascript
   // Type this in a .js or .ts file:
   # calculate fibonacci
   ```
   - Wait a moment for the hint to appear at the end of the line

5. **Enable Debug Logging**:
   - Set `llmLsp.trace.server` to "verbose" in VS Code settings
   - Restart VS Code
   - Check the output panel for detailed logs

## Known Issues

- Inlay hints may take a moment to appear after typing due to API latency
- Comments with # in them will also trigger hints (feature, not a bug)
- Large files may have slower hint generation