from app.markdown_fixup import normalize_tables


def test_converts_tab_separated_block_to_pipe_table():
    text = "Name\tImage\tStatus\nes-node\telasticsearch:8.13.4\trunning"

    result = normalize_tables(text)

    assert result == (
        "| Name | Image | Status |\n"
        "| --- | --- | --- |\n"
        "| es-node | elasticsearch:8.13.4 | running |"
    )


def test_converts_multi_space_separated_block_to_pipe_table():
    text = "Name    Image    Status\nes-node    elasticsearch:8.13.4    running"

    result = normalize_tables(text)

    assert result == (
        "| Name | Image | Status |\n"
        "| --- | --- | --- |\n"
        "| es-node | elasticsearch:8.13.4 | running |"
    )


def test_leaves_real_markdown_table_untouched():
    text = "| Name | Status |\n| --- | --- |\n| es-node | running |"

    result = normalize_tables(text)

    assert result == text


def test_leaves_plain_prose_untouched():
    text = "The es-node container is currently running and healthy."

    result = normalize_tables(text)

    assert result == text


def test_leaves_single_tabular_line_untouched():
    text = "Just one line   with spaces"

    result = normalize_tables(text)

    assert result == text


def test_converts_multiple_data_rows():
    text = "Name\tStatus\nes-node\trunning\nredis-server\texited\nmy-redis\texited"

    result = normalize_tables(text)

    assert result == (
        "| Name | Status |\n"
        "| --- | --- |\n"
        "| es-node | running |\n"
        "| redis-server | exited |\n"
        "| my-redis | exited |"
    )


def test_handles_mismatched_column_counts_by_stopping_block():
    text = "Name\tStatus\nes-node\trunning\nsome prose line"

    result = normalize_tables(text)

    assert result == (
        "| Name | Status |\n| --- | --- |\n| es-node | running |\nsome prose line"
    )
