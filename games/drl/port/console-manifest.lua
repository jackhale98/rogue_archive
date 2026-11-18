-- SPDX-License-Identifier: GPL-2.0-only
-- Writes the WAD manifest for the browser build from upstream's own
-- build.lua (the manifest its drlwad reads): the same WADs and entries,
-- without the ones DRL's console mode never reads (images: the graphical
-- mode's sprites and fonts; sounds and music, which are not shipped), with
-- absolute source masks and output paths.
--
--   lua console-manifest.lua <upstream checkout> <its path for drlwad> <output directory> > manifest.lua
--
-- (The second and third paths are as drlwad sees them: it runs in
-- WebAssembly with host directories mounted.)
local root, src, out = arg[1], arg[2], arg[3]
assert(root and src and out, "usage: console-manifest.lua <upstream checkout> <its path for drlwad> <output directory>")

local env = {}
local chunk = assert(loadfile(root .. "/build.lua"))
setfenv(chunk, env)
chunk()
assert(type(env.build) == "table", "upstream build.lua defines no build table")

local function skipped(entry)
  local kind, folder = entry[2], entry[3]
  return kind == "IMAGE" or folder == "sound" or folder == "music"
end

local function quote(s)
  return string.format("%q", s)
end

local lines = { "build = {" }
for _, wad in ipairs(env.build) do
  table.insert(lines, "  {")
  table.insert(lines, "    " .. quote(out .. "/" .. wad[1]) .. ",")
  for i = 2, #wad do
    local entry = wad[i]
    if not skipped(entry) then
      local mask = entry[1]
      if mask:sub(1, 1) ~= "/" then mask = src .. "/" .. mask end
      local fields = { quote(mask), quote(entry[2]), quote(entry[3]) }
      local keys = {}
      for k in pairs(entry) do
        if type(k) == "string" then table.insert(keys, k) end
      end
      table.sort(keys)
      for _, k in ipairs(keys) do
        table.insert(fields, k .. " = " .. tostring(entry[k]))
      end
      table.insert(lines, "    { " .. table.concat(fields, ", ") .. " },")
    end
  end
  table.insert(lines, "  },")
end
table.insert(lines, "}")
print(table.concat(lines, "\n"))
