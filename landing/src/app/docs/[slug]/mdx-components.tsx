"use client";

import {
  Callout,
  Steps,
  Step,
  Tabs,
  Tab,
  Card,
  CardGrid,
  FileTree,
  ApiTable,
  Badge,
  AgentContext,
  CodeBlock,
} from "@arach/dewey";
import type { MDXComponents } from "mdx/types";

/**
 * Component map for MDX rendering in docs.
 * These are available as JSX tags in any .md doc file:
 *
 *   <Steps>
 *     <Step title="Register">Create an agent override.</Step>
 *     <Step title="Start">Run `scout up`.</Step>
 *   </Steps>
 *
 *   <Badge variant="success">stable</Badge>
 *
 *   <Callout type="warning">This is experimental.</Callout>
 */
export const docsComponents: MDXComponents = {
  // dewey components
  Callout,
  Steps,
  Step,
  Tabs,
  Tab,
  Card,
  CardGrid,
  FileTree,
  ApiTable,
  Badge,
  AgentContext,
  CodeBlock,
};
