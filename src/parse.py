import ast
import json
import sys

def ast2json(node):
    if isinstance(node, ast.AST):
        node_json = {node.__class__.__name__: {}}
        for name, value in ast.iter_fields(node):
            node_json[node.__class__.__name__][name] = ast2json(value)
        return node_json
    elif isinstance(node, list):
        return [ast2json(child) for child in node]
    else:
        return node

if __name__ == "__main__":
    with open(sys.argv[1], 'r') as file:
        code = file.read()
    tree = ast.parse(code)
    print(json.dumps(ast2json(tree)))
