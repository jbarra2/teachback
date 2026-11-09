import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";
import { COURSE_ID, courses } from "@/lib/api-client/fake-api/fixtures";
import { CourseLibrary } from "./course-library";
import { errorResponse, mockClient, networkClient } from "./test-clients";

const nameField = () => screen.getByLabelText("New course");
const create = () =>
  act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Create course/ })),
  );

describe("CourseLibrary", () => {
  // T32: submitted before the page's JavaScript loads, the browser sends the form itself. With the
  // default GET that put the course name in the URL, the server log and the history (seen live).
  it("never sends what was typed in a URL, even before it's interactive", () => {
    render(<CourseLibrary client={mockClient()} />);
    expect(
      screen.getByRole("form", { name: "Create a course" }),
    ).toHaveAttribute("method", "post");
  });

  it("lists the courses, each linking to its page", async () => {
    render(<CourseLibrary client={mockClient()} />);
    const link = await screen.findByRole("link", { name: courses[0]!.name });
    expect(link).toHaveAttribute("href", `/courses/${COURSE_ID}`);
    expect(screen.getAllByRole("listitem")).toHaveLength(courses.length);
  });

  it("shows a spinner while loading", () => {
    render(<CourseLibrary client={mockClient()} />);
    expect(screen.getByText("Loading your courses…")).toBeInTheDocument();
  });

  it("shows the empty state when there are no courses", async () => {
    const { client } = networkClient(async () => Response.json([]));
    render(<CourseLibrary client={client} />);
    expect(await screen.findByText("No courses yet")).toBeInTheDocument();
  });

  it("renders an HTML-looking course name as text", async () => {
    const name = '<img src=x onerror="alert(1)">';
    const { client } = networkClient(async () =>
      Response.json([
        { id: COURSE_ID, name, createdAt: "2026-10-20T17:00:00.000Z" },
      ]),
    );
    const { container } = render(<CourseLibrary client={client} />);
    expect(await screen.findByRole("link", { name })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a safe message when loading fails, and retries", async () => {
    let fail = true;
    const { client } = networkClient(async () =>
      fail
        ? new Response("<html>stack trace</html>", { status: 500 })
        : Response.json([]),
    );
    render(<CourseLibrary client={client} />);
    expect(
      await screen.findByText("Couldn't load your courses"),
    ).toBeInTheDocument();
    expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/stack trace/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No courses yet")).toBeInTheDocument();
  });

  it("creates a course with the trimmed name and adds it to the list", async () => {
    render(<CourseLibrary client={mockClient()} />);
    await screen.findByRole("link", { name: courses[0]!.name });
    fireEvent.change(nameField(), { target: { value: "  CHEM 142  " } });
    await create();
    const link = await screen.findByRole("link", { name: "CHEM 142" });
    expect(link.getAttribute("href")).toMatch(/^\/courses\/c[a-z0-9]{24}$/);
    expect(nameField()).toHaveValue("");
  });

  it("counts the name up to 120 characters", () => {
    render(<CourseLibrary client={mockClient()} />);
    expect(nameField()).toHaveAttribute("maxlength", "120");
    fireEvent.change(nameField(), { target: { value: "x".repeat(120) } });
    expect(screen.getByText("120 / 120")).toBeInTheDocument();
  });

  it("asks for a name instead of sending a blank one", async () => {
    const { client, network } = networkClient(async () => Response.json([]));
    render(<CourseLibrary client={client} />);
    await screen.findByText("No courses yet");
    fireEvent.change(nameField(), { target: { value: "   " } });
    await create();
    expect(screen.getByText("Enter a course name.")).toBeInTheDocument();
    expect(nameField()).toHaveFocus();
    expect(network).toHaveBeenCalledOnce(); // only the list
  });

  it("shows the server's message for the name on a 400", async () => {
    const { client } = networkClient(async (request) =>
      request.method === "GET"
        ? Response.json([])
        : errorResponse(400, "VALIDATION_ERROR", "Some fields are invalid.", {
            formErrors: [],
            fieldErrors: { name: ["Must be at most 120 characters."] },
          }),
    );
    render(<CourseLibrary client={client} />);
    await screen.findByText("No courses yet");
    fireEvent.change(nameField(), { target: { value: "Too long" } });
    await create();
    expect(nameField()).toHaveAccessibleDescription(
      "Must be at most 120 characters.",
    );
  });

  it("creates once on a double submit", async () => {
    let finish = () => {};
    const { client, network } = networkClient((request) =>
      request.method === "GET"
        ? Promise.resolve(Response.json([]))
        : new Promise((resolve) => {
            finish = () =>
              resolve(
                Response.json(
                  {
                    id: COURSE_ID,
                    name: "CHEM 142",
                    createdAt: "2026-10-20T17:00:00.000Z",
                  },
                  { status: 201 },
                ),
              );
          }),
    );
    render(<CourseLibrary client={client} />);
    await screen.findByText("No courses yet");
    fireEvent.change(nameField(), { target: { value: "CHEM 142" } });
    const form = screen.getByRole("form", { name: "Create a course" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => finish());
    expect(network).toHaveBeenCalledTimes(2); // the list, then one create
    expect(
      await screen.findByRole("link", { name: "CHEM 142" }),
    ).toBeInTheDocument();
  });
});
