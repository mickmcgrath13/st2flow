//@flow

import type { TaskInterface } from '@stackstorm/st2flow-model/interfaces';

import React, { Component } from 'react';
import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import cx from 'classnames';

import { StringField } from '@stackstorm/module-auto-form/fields';

import Property from './property';

import style from './style.css';

type TransitionProps = {
  task: TaskInterface,
  issueModelCommand?: Function,
};

@connect(
  null,
  (dispatch) => ({
    issueModelCommand: (command, ...args) => {
      dispatch({
        type: 'MODEL_ISSUE_COMMAND',
        command,
        args,
      });
    },
  })
)
export default class OrquestaTransition extends Component<TransitionProps, {}> {
  static propTypes = {
    task: PropTypes.object.isRequired,
    issueModelCommand: PropTypes.func,
  }

  handleTaskProperty(name: string | Array<string>, value: any) {
    const { task, issueModelCommand } = this.props;

    if (value) {
      issueModelCommand && issueModelCommand('setTaskProperty', task, name, value);
    }
    else {
      issueModelCommand && issueModelCommand('deleteTaskProperty', task, name);
    }
  }

  style = style
  joinFieldRef = React.createRef();

  render() {
    const { task } = this.props;

    return [
      <Property key="join" name="Join" description="Allows to synchronize multiple parallel workflow branches and aggregate their data."  value={!!task.join} onChange={value => this.handleTaskProperty('join', value ? 'all' : false)}>
        {
          task.join && (
            <div className={cx(this.style.propertyChild, this.style.radioGroup)}>
              <div className={cx(this.style.radio, task.join === 'all' && this.style.checked)} onClick={() => this.handleTaskProperty('join', 'all')}>
                Join all tasks
              </div>
              <label htmlFor="joinField" className={cx(this.style.radio, task.join !== 'all' && this.style.checked)} onClick={(e) => this.handleTaskProperty('join', parseInt((this.joinFieldRef.current || {}).value, 10))} >
                Join <input type="text" id="joinField" size="3" className={this.style.radioField} ref={this.joinFieldRef} value={isNaN(task.join) ? 10 : task.join} onChange={e => this.handleTaskProperty('join', parseInt(e.target.value, 10))} /> tasks
              </label>
            </div>
          )
        }
      </Property>,
      <Property key="with" name="With Items" description="Run an action or workflow associated with a task multiple times." value={!!task.with} onChange={value => this.handleTaskProperty('with', value ? { items: 'x in <% ctx(y) %>' } : false)}>
        {
          task.with && (
            <div className={this.style.propertyChild}>
              <StringField name="items" value={task.with.items} onChange={value => this.handleTaskProperty([ 'with', 'items' ], value)} />
              <StringField name="concurrency" value={task.with.concurrency} onChange={value => this.handleTaskProperty([ 'with', 'concurrency' ], value)} />
            </div>
          )
        }
      </Property>,
    ];
  }
}