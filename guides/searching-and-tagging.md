# Searching and tagging

KnowledgeManagement gives you two ways to navigate your notes quickly: full-text search powered by Postgres and a tag system that lets you group notes by topic.

## Searching notes

Press `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux to open the command palette. Start typing and the palette shows matching notes ranked by relevance. Click a result or press Enter to open it.

Search uses Postgres full-text search under the hood. A few things worth knowing:

- Words are stemmed, so searching for "running" also matches "run" and "runs".
- Quoted phrases like `"project kickoff"` match that exact sequence of words.
- Separate terms with `OR` to find notes that contain either term: `kickoff OR retrospective`.
- Prefix a term with `-` to exclude notes containing it: `project -archived`.
- Very short queries (fewer than two characters) are not sent to the server.

Search results include a short highlighted snippet so you can see the matching context before opening the note.

## Tagging notes

Add a tag anywhere in a note body by typing `#tagname`. Tags are lowercase, can contain letters, numbers, hyphens, and forward slashes, and must start with a letter or digit. Some examples:

```
Working on the #project/website redesign.
Status: #draft
```

Tags are extracted whenever a note is saved. You do not need to declare them anywhere else.

### Viewing tags

The sidebar shows a list of all tags used across the vault, ordered by how many notes use each tag. Click a tag to open its index page, which lists every note that contains that tag.

The tag index page is also available at `/vault/<id>/tags/<tagname>` if you want to share a direct link.

### Tags and the graph

Tagged notes appear in the knowledge graph view alongside wiki-link connections. To open the graph, press `Ctrl+K`, type "graph", and select "Go to graph" from the results. The graph renders notes as nodes, with edges drawn for each wiki-link. You can pan, zoom, and click a node to navigate to that note.

## Tips

- Combine search and tags: search for a term, then narrow down by clicking a tag in the sidebar.
- Nested tags like `#project/website` and `#project/mobile` both show up under `#project` in the tag list, making it easy to group related work.
- Tags inside code fences and inline code spans are ignored so code examples do not accidentally create tags.
