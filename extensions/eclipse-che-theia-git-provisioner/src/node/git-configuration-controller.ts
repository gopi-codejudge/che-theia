/**********************************************************************
 * Copyright (c) 2018-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 ***********************************************************************/

// eslint-disable-next-line spaced-comment
/// <reference types='@theia/core/src/typings/nsfw/index'/>

import * as ini from 'ini';
import * as nsfw from 'nsfw';

import { CheGitClient, CheGitService, GIT_USER_EMAIL, GIT_USER_NAME } from '../common/git-protocol';
import { createFile, pathExists, readFile, writeFile } from 'fs-extra';
import { inject, injectable } from 'inversify';

import { CheTheiaUserPreferencesSynchronizer } from '@eclipse-che/theia-user-preferences-synchronizer/lib/node/che-theia-preferences-synchronizer';
import { Disposable } from '@theia/core';
import { homedir } from 'os';
import { resolve } from 'path';

export const GIT_USER_CONFIG_PATH = resolve(homedir(), '.gitconfig');
export const GIT_GLOBAL_CONFIG_PATH = '/etc/gitconfig';

export interface UserConfiguration {
  name: string | undefined;
  email: string | undefined;
}

@injectable()
export class GitConfigurationController implements CheGitService {
  @inject(CheTheiaUserPreferencesSynchronizer)
  protected preferencesService: CheTheiaUserPreferencesSynchronizer;

  protected preferencesHandler: Disposable | undefined;

  protected gitConfigWatcher: nsfw.NSFW | undefined;

  protected client: CheGitClient;

  public async watchGitConfigChanges(): Promise<void> {
    if (this.gitConfigWatcher) {
      return;
    }

    const gitConfigExists = await pathExists(GIT_USER_CONFIG_PATH);
    if (!gitConfigExists) {
      await createFile(GIT_USER_CONFIG_PATH);
    }

    this.gitConfigWatcher = await nsfw(GIT_USER_CONFIG_PATH, async (events: nsfw.ChangeEvent[]) => {
      for (const event of events) {
        if (event.action === nsfw.actions.MODIFIED) {
          const userConfig = await this.getUserConfigurationFromGitConfig();
          const preferences = await this.preferencesService.getPreferences();

          (preferences as { [index: string]: string })[GIT_USER_NAME] = userConfig.name!;
          (preferences as { [index: string]: string })[GIT_USER_EMAIL] = userConfig.email!;

          await this.preferencesService.setPreferences(preferences);
        }
      }
    });
    await this.gitConfigWatcher.start();
  }

  async getUserConfigurationFromGitConfig(): Promise<UserConfiguration> {
    let name: string | undefined;
    let email: string | undefined;
    const userConfig = await this.readUserConfigurationFromGitConfigFile(GIT_USER_CONFIG_PATH);
    if (userConfig) {
      name = userConfig.name;
      email = userConfig.email;
    }
    if (name && email) {
      return { name, email };
    }
    const globalConfig = await this.readUserConfigurationFromGitConfigFile(GIT_GLOBAL_CONFIG_PATH);
    if (globalConfig) {
      name = name ? name : globalConfig.name;
      email = email ? email : globalConfig.email;
    }
    return { name, email };
  }

  protected async readUserConfigurationFromGitConfigFile(path: string): Promise<UserConfiguration | undefined> {
    if (!(await pathExists(path))) {
      return;
    }
    const gitConfigContent = await readFile(path, 'utf-8');
    const gitConfig = ini.parse(gitConfigContent);
    if (gitConfig.user !== undefined) {
      const { name, email } = gitConfig.user;
      return { name, email };
    }
  }

  public async watchUserPreferencesChanges(): Promise<void> {
    if (this.preferencesHandler) {
      return;
    }

    this.preferencesHandler = this.preferencesService.onUserPreferencesModify(preferences => {
      const config = this.getUserConfiguration(preferences);
      this.updateGlobalGitConfig(config);
      this.client.firePreferencesChanged();
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected getUserConfiguration(preferences: any): UserConfiguration {
    return {
      name: preferences[GIT_USER_NAME],
      email: preferences[GIT_USER_EMAIL],
    };
  }

  protected async updateGlobalGitConfig(config: UserConfiguration): Promise<void> {
    if (config.name === undefined && config.email === undefined) {
      return;
    }

    const gitConfig = { user: {} as UserConfiguration };

    if (config.name) {
      gitConfig.user.name = config.name;
    }

    if (config.email) {
      gitConfig.user.email = config.email;
    }

    await this.gitConfigWatcher!.stop();
    await writeFile(GIT_USER_CONFIG_PATH, ini.stringify(gitConfig));
    await this.gitConfigWatcher!.start();
  }

  setClient(client: CheGitClient): void {
    this.client = client;
  }

  dispose(): void {
    // nothing todo
  }
}
