import os
from io import StringIO

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from agent import EmailAgent, LinkedInAgent


load_dotenv()


st.set_page_config(page_title="EmailAgent Simple", page_icon="@", layout="wide")
st.title("EmailAgent Simple")
st.caption("Upload a CSV, pick columns, run email/LinkedIn lookup, and download the updated file.")

with st.sidebar:
    st.subheader("API Setup")
    openai_api_key = st.text_input(
        "OPENAI_API_KEY",
        value=os.getenv("OPENAI_API_KEY", ""),
        type="password",
    )
    serper_api_key = st.text_input(
        "SERPER_API_KEY",
        value=os.getenv("SERPER_API_KEY", ""),
        type="password",
    )
    model_name = st.text_input(
        "OpenAI model",
        value=os.getenv("OPENAI_MODEL", "gpt-4.1-2025-04-14"),
        help="Default is gpt-4.1-2025-04-14. You can override this.",
    )


def read_uploaded_csv(file_obj):
    file_bytes = file_obj.getvalue()
    try:
        return pd.read_csv(StringIO(file_bytes.decode("utf-8")))
    except UnicodeDecodeError:
        return pd.read_csv(StringIO(file_bytes.decode("latin-1")))


uploaded_file = st.file_uploader("Upload CSV", type=["csv"])

if uploaded_file:
    try:
        input_df = read_uploaded_csv(uploaded_file)
    except Exception as e:
        st.error(f"Could not read CSV: {e}")
        st.stop()

    if input_df.empty:
        st.warning("This CSV is empty.")
        st.stop()

    columns = list(input_df.columns)

    col1, col2, col3 = st.columns(3)
    with col1:
        name_column = st.selectbox("Name column", options=columns, index=0)
    with col2:
        additional_info_column = st.selectbox(
            "Additional info column (optional)",
            options=["(none)"] + columns,
            index=0,
        )
    with col3:
        mode = st.selectbox("Run mode", options=["Email only", "LinkedIn only", "Both"])

    out1, out2 = st.columns(2)
    with out1:
        email_column = st.text_input("Email column name", value="agent_email")
    with out2:
        linkedin_column = st.text_input("LinkedIn column name", value="agent_linkedin")

    st.write("Preview")
    st.dataframe(input_df.head(20), use_container_width=True)

    if st.button("Run Agent", type="primary"):
        if not openai_api_key.strip() or not serper_api_key.strip():
            st.error("Please provide both OPENAI_API_KEY and SERPER_API_KEY.")
            st.stop()

        os.environ["OPENAI_API_KEY"] = openai_api_key.strip()
        os.environ["SERPER_API_KEY"] = serper_api_key.strip()
        os.environ["OPENAI_MODEL"] = model_name.strip()

        if additional_info_column != "(none)":
            people_df = input_df[[name_column, additional_info_column]].copy()
            people_df.columns = ["name", "additional_info"]
        else:
            people_df = input_df[[name_column]].copy()
            people_df.columns = ["name"]
            people_df["additional_info"] = ""

        with st.spinner("Running lookup... this may take a while depending on file size."):
            try:
                if mode == "Email only":
                    agent = EmailAgent(
                        people_df,
                        openai_api_key=openai_api_key.strip(),
                        verbose=False,
                        model=model_name.strip(),
                    )
                    result_df = agent.find_email_addresses(
                        email_column=email_column,
                        original_df=input_df.copy(),
                        csv_path=None,
                        save_every=1,
                        name_column=name_column,
                    )
                elif mode == "LinkedIn only":
                    agent = LinkedInAgent(
                        people_df,
                        openai_api_key=openai_api_key.strip(),
                        verbose=False,
                        model=model_name.strip(),
                    )
                    result_df = agent.find_linkedin_profiles(
                        linkedin_column=linkedin_column,
                        original_df=input_df.copy(),
                        csv_path=None,
                        save_every=1,
                        name_column=name_column,
                    )
                else:
                    agent = EmailAgent(
                        people_df,
                        openai_api_key=openai_api_key.strip(),
                        verbose=False,
                        model=model_name.strip(),
                    )
                    result_df = agent.find_email_addresses(
                        email_column=email_column,
                        original_df=input_df.copy(),
                        csv_path=None,
                        save_every=1,
                        name_column=name_column,
                    )
                    if linkedin_column != "agent_linkedin" and "agent_linkedin" in result_df.columns:
                        result_df[linkedin_column] = result_df["agent_linkedin"]

            except Exception as e:
                st.error(f"Agent failed: {e}")
                st.stop()

        st.success("Finished.")
        st.dataframe(result_df.head(50), use_container_width=True)

        csv_bytes = result_df.to_csv(index=False).encode("utf-8")
        original_name = os.path.splitext(uploaded_file.name)[0]
        output_name = f"{original_name}_with_contacts.csv"
        st.download_button(
            label="Download updated CSV",
            data=csv_bytes,
            file_name=output_name,
            mime="text/csv",
        )
else:
    st.info("Upload a CSV to get started.")
