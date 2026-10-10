import { Badge, Card, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import type { Snapshot } from "../model.js";
import { Data } from "./components.js";

export function ContextInventory({ snapshot }: { snapshot?: Snapshot }) {
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  return (
    <details className="context-inventory" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Current runtime information · not historical request evidence</summary>
      {open && (
        <div className="inventory-scroll">
          <Data
            label="Current runtime effective prompt · may not yet be sent"
            data={snapshot?.currentPrompt}
            defaultOpen={false}
          />
          <Text as="p" size="2" color="gray">
            Current active ≠ provider-visible. MCP connection status is unavailable.
          </Text>
          <details open={toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
            <summary>Current tools</summary>
            {toolsOpen &&
              snapshot?.tools.map((tool) => (
                <Card key={tool.name} className="inventory-card">
                  <Text weight="bold">{tool.name}</Text>
                  <Flex gap="1" wrap="wrap">
                    <Badge>{tool.namespace ?? "tool"}</Badge>
                    <Badge>{tool.exposure}</Badge>
                    <Badge>{tool.active ? "active" : "inactive"}</Badge>
                    <Badge>{tool.callable ? "callable" : "not callable"}</Badge>
                  </Flex>
                  <Text as="p" size="2" color="gray">
                    {tool.description}
                  </Text>
                  <Data label={`Schema · ${tool.name}`} data={tool.schema} defaultOpen={false} />
                </Card>
              ))}
          </details>
          <details open={skillsOpen} onToggle={(event) => setSkillsOpen(event.currentTarget.open)}>
            <summary>Currently advertised skills</summary>
            <Text as="p" size="2" color="gray">
              Advertised or read does not prove model compliance. Historical catalogs are unavailable.
            </Text>
            {skillsOpen &&
              snapshot?.skills.map((skill) => (
                <Card key={skill.path} className="inventory-card">
                  <Text weight="bold">{skill.name}</Text>
                  <Badge>advertised</Badge>
                  <Text as="p" size="2">
                    {skill.description}
                  </Text>
                  <Text size="1" color="gray">
                    {skill.path}
                  </Text>
                </Card>
              ))}
          </details>
        </div>
      )}
    </details>
  );
}
